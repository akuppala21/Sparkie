"""One owner operation, durable admission, fresh loopback endpoints and exact retirement."""

import os
from pathlib import Path
import pwd
import subprocess
import uuid

import pytest

from sparkie_sparks.authority import Owner, OwnerBinding
from sparkie_sparks.composition import compose
from sparkie_sparks.idle import IdlePower
from sparkie_sparks.operations import NotDispatched, OperationStore, intent
from sparkie_sparks.recipe_services import RecipeServices, ServiceObservation, service_holds_node
from sparkie_sparks.service_definitions import ARTIFACTS, GLM, compose_file, recipe
from sparkie_sparks.service_remote import RemoteServices
from sparkie_sparks.service_worker import ServiceWorker
from sparkie_sparks.workspace_types import ComputeNode

OWNER = Owner('owner-generation', 'web')
BINDING = OwnerBinding(OWNER.generation, 'owner', 'test', '', 101, 101)
NODE = ComputeNode('spark4', '4' * 32, '192.0.2.4')


def test_service_worker_checks_the_enrolled_address_despite_ambient_ssh_settings(tmp_path):
    table = {'user': 'fixture', 'executable': '/fixture/worker.pyz', 'config': '/fixture/worker.json'}
    remote = RemoteServices('a' * 32, [(NODE, table)])
    config = tmp_path / 'ssh_config'
    config.write_text('Host *\n  HostName elsewhere.invalid\n  HostKeyAlias elsewhere\n'
                      '  UserKnownHostsFile /wrong/file\n  GlobalKnownHostsFile /other/file\n'
                      '  Port 2222\n  ForwardAgent yes\n  ControlPath /wrong/socket\n'
                      '  ProxyCommand false\n  LocalForward 127.0.0.1:23456 localhost:22\n')
    command = remote.commands[NODE]
    result = subprocess.run([command[0], '-F', str(config), '-G', *command[1:]],
                            check=True, capture_output=True, text=True)
    fields = dict(line.split(' ', 1) for line in result.stdout.splitlines() if ' ' in line)
    assert fields['hostname'] == fields['hostkeyalias'] == NODE.host
    user_home = Path(pwd.getpwuid(os.getuid()).pw_dir)
    assert fields['userknownhostsfile'] in {'~/.ssh/known_hosts', str(user_home / '.ssh/known_hosts')}
    assert fields['globalknownhostsfile'] == '/dev/null'
    assert fields['port'] == '22' and fields['forwardagent'] == 'no'
    assert fields.get('proxycommand', 'none') == fields.get('controlpath', 'none') == 'none'
    assert 'localforward' not in fields


class Effects:
    def __init__(self):
        self.state, self.calls, self.refuse, self.fail_read = 'ready', [], False, False

    def plan(self, r, node, instance):
        return 'sparkie-' + instance

    def start(self, r, node, instance, workload):
        self.calls.append(('start', instance))

    def stop(self, r, node, instance, workload, *, operation):
        if self.refuse:
            raise NotDispatched('The worker refused before sending.')
        self.calls.append(('stop', instance))
        self.state = 'stopped'
        raise TimeoutError('Simulated lost stop reply.')

    def observe(self, r, node, instance, workload):
        if self.fail_read:
            raise OSError('Unavailable')
        return ServiceObservation(self.state, workload, r.port if self.state == 'ready' else None)

    def logs(self, r, node, instance, workload):
        return ['Container ' + self.state + '.']


def rig(tmp_path):
    store = OperationStore(tmp_path / 'operations.sqlite')
    backend = Effects()
    recipes = [recipe(n, (NODE.spark_id,)) for n in (ARTIFACTS, GLM)]
    services = RecipeServices(
        store,
        recipes=recipes,
        nodes={NODE.spark_id: NODE},
        backends={'app': backend, 'model': backend},
        authorize=lambda operation, target: store.get(operation)['intent'] == target,
    )
    controls = compose(
        store,
        [{'id': NODE.spark_id, 'address': NODE.host, 'user': 'fixture', 'hostname': 'spark4'}],
        binding=lambda: BINDING,
        services=services,
    )
    return controls, services, backend


def prepare(controls, name=ARTIFACTS, *, stop=None):
    args = {
        'action': 'stop_service' if stop else 'start_service',
        'spark': NODE.spark_id,
        'recipe': name,
        'revision': recipe(name, ()).revision,
    }
    if stop:
        args['instance'] = stop
    return controls.prepare(OWNER, request_key=uuid.uuid4().hex, request_ref='owner fixture', **args)


def confirm(controls, row):
    return controls.confirm(OWNER, row['id'], row['digest'])


def test_single_reserved_node_and_stable_alias_after_replacement(tmp_path):
    controls, services, effects = rig(tmp_path)
    start = prepare(controls)
    assert effects.calls == [] and confirm(controls, start)['state'] == 'succeeded'
    assert services.endpoint(ARTIFACTS)['instance'] == start['id']
    assert confirm(controls, prepare(controls, GLM))['state'] == 'failed'
    with controls.store._db() as db:
        assert service_holds_node(db, NODE.spark_id) and IdlePower._held(db, NODE.spark_id)
    effects.fail_read = True
    assert services.endpoint(ARTIFACTS) is None
    effects.fail_read = False
    stale = prepare(controls, stop=start['id'])
    assert confirm(controls, prepare(controls, stop=start['id']))['state'] == 'succeeded'
    assert services.endpoint(ARTIFACTS) is None
    effects.state = 'ready'
    new = prepare(controls)
    assert confirm(controls, new)['state'] == 'succeeded'
    assert confirm(controls, stale)['state'] == 'failed'
    assert services.endpoint(ARTIFACTS, instance=start['id']) is None
    assert services.endpoint(ARTIFACTS)['instance'] == new['id']
    assert effects.calls == [('start', start['id']), ('stop', start['id']), ('start', new['id'])]


def test_uncertain_start_reconciliation_and_exact_stop_without_relaunch(tmp_path):
    controls, services, effects = rig(tmp_path)
    effects.state = 'unknown'
    start = prepare(controls)
    assert confirm(controls, start)['state'] == 'uncertain'
    assert controls.check(OWNER, start['id'])['state'] == 'uncertain'
    with pytest.raises(ValueError):
        prepare(controls, stop='f' * 32)
    stop = prepare(controls, stop=start['id'])
    assert confirm(controls, stop)['state'] == 'succeeded'
    assert controls.check(OWNER, start['id'])['state'] == 'failed'
    assert effects.calls == [('start', start['id']), ('stop', start['id'])]


def test_stop_refusal_keeps_original_endpoint_and_generation(tmp_path):
    controls, services, effects = rig(tmp_path)
    row = prepare(controls)
    confirm(controls, row)
    effects.refuse = True
    stop = prepare(controls, stop=row['id'])
    assert confirm(controls, stop)['state'] == 'failed'
    assert services.endpoint(ARTIFACTS, instance=row['id'])['ready']
    with pytest.raises(PermissionError):
        controls.service_logs(Owner('revoked', 'web'), ARTIFACTS, row['id'])
    assert controls.service_logs(OWNER, ARTIFACTS, row['id']) == ['Container ready.']
    assert all(k not in str(controls.service_catalog(OWNER)) for k in ('127.0.0.1', NODE.host))


def test_canonical_target_refuses_arbitrary_inputs_hub_and_unreviewed_revision(tmp_path):
    controls, services, effects = rig(tmp_path)
    original = intent('start_service', 'spark4', recipe=ARTIFACTS, revision=recipe(ARTIFACTS, ()).revision)
    for extra in ({'spark': 'spark1'}, {'command': 'sh'}, {'instance': 'f' * 32}, {'revision': 'b' * 64}):
        with pytest.raises((ValueError, NotDispatched, TypeError)):
            services.dispatch('a' * 32, {**original, **extra})
    assert not effects.calls


def test_workspace_admission_checked_in_same_transaction(tmp_path):
    controls, services, effects = rig(tmp_path)
    with controls.store._db() as db:
        db.execute('CREATE TABLE workspace_leases (held INTEGER, node TEXT)')
        db.execute('INSERT INTO workspace_leases VALUES (1,?)', ('{"spark_id":"spark4"}',))
    assert confirm(controls, prepare(controls))['state'] == 'failed'
    assert not effects.calls


def test_worker_stop_fences_delayed_start_and_wrong_machine(tmp_path):
    cfg = {
        'schema': 1,
        'controller': 'a' * 32,
        'spark': 'spark4',
        'machine': NODE.machine_id,
        'hub_machine': '1' * 32,
        'state_dir': str(tmp_path / 'private'),
        'data': {ARTIFACTS: str(tmp_path)},
    }
    with pytest.raises(ValueError):
        ServiceWorker(cfg, identity=lambda: 'b' * 32)
    calls = []

    def run(args, **kwargs):
        calls.append(args)
        assert args[1:3] == ['ps', '-a']
        return ''

    worker = ServiceWorker(cfg, identity=lambda: NODE.machine_id, run=run)
    instance = 'b' * 32
    base = {k: cfg[k] for k in ('spark', 'controller', 'machine')}
    base.update(
        instance=instance,
        workload='sparkie-' + instance,
        recipe=ARTIFACTS,
        revision=recipe(ARTIFACTS, ()).revision,
    )
    assert worker.handle({**base, 'operation': 'c' * 32, 'method': 'stop'}) is None
    assert worker.handle({**base, 'operation': instance, 'method': 'start'}) is None
    result = worker.handle({**base, 'operation': instance, 'method': 'observe'})
    assert result['state'] == 'stopped' and len(calls) == 1


@pytest.mark.parametrize('name', [ARTIFACTS, GLM])
def test_reviewed_definitions_pin_identity_limits_and_loopback_only(name):
    config = compose_file(name, 'a' * 32, NODE.machine_id, '/test/input', '/test/cache')['services'][
        'service'
    ]
    assert config['ports'] == [
        {'target': 8000, 'published': str(recipe(name, ()).port), 'host_ip': '127.0.0.1', 'protocol': 'tcp'}
    ]
    assert config['image'].split('@sha256:')[1] and config['user'] != '0' and config['read_only']
    assert config['cap_drop'] == ['ALL'] and config['labels']['sparkie.protected'] == 'true'
    assert all(m['read_only'] for m in config['volumes'] if m['target'] != '/cache')


def test_service_reservation_blocks_native_workspace_and_manual_sleep(tmp_path):
    from test_workspace_leases import Effects as SandboxEffects, manager, REQUEST, SCOPE

    controls, services, effects = rig(tmp_path)
    leases = manager(controls.store, SandboxEffects(controls.store), nodes=[NODE])
    start = prepare(controls)
    assert confirm(controls, start)['state'] == 'succeeded'
    with pytest.raises(RuntimeError):
        leases.acquire(SCOPE, REQUEST)
    assert all(r.cpu == 0 for r in leases.reservations().values())


def test_service_requested_wake_requires_exact_reservation_and_live_owner(tmp_path):
    from test_idle import rig as power_rig
    from test_power import NODE as POWER_NODE

    store, meter, transport, power, policy, _, _ = power_rig(tmp_path)
    node = ComputeNode(POWER_NODE['id'], POWER_NODE['machine_id'], POWER_NODE['address'])
    r = recipe(ARTIFACTS, (node.spark_id,))
    effects = Effects()
    services = RecipeServices(
        store,
        recipes=[r],
        nodes={node.spark_id: node},
        backends={'app': effects},
        authorize=lambda operation, target: store.get(operation)['intent'] == target,
        wake=lambda operation, node: policy.wake_service(operation, node)['state'] == 'succeeded',
    )
    controls = compose(store, [POWER_NODE], binding=lambda: BINDING, power=power, services=services)
    args = dict(recipe=r.name, revision=r.revision, spark=node.spark_id, action='start_service')
    row = controls.prepare(OWNER, request_key='start', request_ref='fixture', **args)
    with pytest.raises(NotDispatched):
        policy.wake_service(row['id'], node)
    assert controls.confirm(OWNER, row['id'], row['digest'])['state'] == 'succeeded'
    assert policy._get(row['id'])['state'] == 'succeeded'
    sleep = controls.prepare(
        OWNER, request_key='manual-sleep', request_ref='fixture', spark=node.spark_id, action='sleep'
    )
    assert controls.confirm(OWNER, sleep['id'], sleep['digest'])['state'] == 'failed'
    assert 'sleep' not in transport.calls
