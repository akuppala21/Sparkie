import json
import subprocess
from pathlib import Path
import stat
from types import SimpleNamespace as Result

import pytest

from sparkie_sparks.authority import Owner
from sparkie_sparks.operations import NotDispatched, OperationStore
from sparkie_sparks.workload_worker import handle
from sparkie_sparks.workloads import StopWorkload

CONTAINER = 'a' * 64
REQUEST = {'mode': 'stop', 'hostname': 'compute-fixture', 'container': CONTAINER, 'protected': ['protected-service']}


def test_wrong_machine_hub_and_invalid_identity_never_reach_docker():
    def no_command(*a, **kw): pytest.fail('Refusal must happen before Docker')
    for host, request in [('hub-host.invalid', {**REQUEST, 'hostname': 'hub-host.invalid'}), ('wrong', REQUEST),
                          ('compute-fixture', {**REQUEST, 'container': 'name; reboot'})]:
        assert handle(request, hostname=host, runner=no_command)['status'] == 'refused'


@pytest.mark.parametrize('name,label', [('protected-service', None), ('job', 'true')])
def test_infrastructure_cannot_be_stopped(name, label):
    calls = []
    def runner(args, **kw):
        calls.append(args)
        return Result(returncode=0, stdout='\n'.join(map(json.dumps, [CONTAINER, '/' + name, True, label])))
    assert handle(REQUEST, hostname='compute-fixture', runner=runner)['status'] == 'refused'
    assert len(calls) == 1 and calls[0][3:6] == ['--host', 'unix:///var/run/docker.sock', 'inspect']


def test_docker_stop_timeout_is_uncertain_and_no_raw_error_or_secret_is_returned():
    calls = []
    def runner(args, **kw):
        calls.append(args)
        if args[5] == 'stop': raise subprocess.TimeoutExpired('SECRET', 20)
        return Result(returncode=0, stdout='\n'.join(map(json.dumps, [CONTAINER, '/job', True, None])))
    row = handle(REQUEST, hostname='compute-fixture', runner=runner)
    assert row['status'] == 'sent' and 'SECRET' not in str(row)
    assert len(calls) == 2 and calls[-1][:2] == ['docker', '--config']
    assert calls[-1][3:] == ['--host', 'unix:///var/run/docker.sock', 'stop', '--time', '10', CONTAINER]


def test_inspect_failure_never_becomes_a_successful_stop():
    def runner(*a, **kw): return Result(returncode=1, stdout='', stderr='SECRET')
    assert handle(REQUEST, hostname='compute-fixture', runner=runner)['status'] == 'unknown'
    assert handle({**REQUEST, 'mode': 'observe'}, hostname='compute-fixture', runner=runner)['status'] == 'unknown'


def test_private_adapter_uses_strict_ssh_and_verifies_exact_stopped_container():
    calls = []
    def runner(args, **kwargs):
        calls.append(args)
        return Result(returncode=0, stdout=json.dumps({'hostname': 'compute-fixture', 'container': CONTAINER, 'status': 'stopped'}))
    adapter = StopWorkload([{'id': 'spark2', 'hostname': 'compute-fixture', 'address': '192.0.2.2', 'user': 'owner'}], runner=runner)
    target = {'action': 'stop_workload', 'spark': 'spark2', 'container': CONTAINER}
    assert adapter.observe('operation', target) == 'succeeded'
    assert 'StrictHostKeyChecking=yes' in calls[0] and calls[0][-2] == 'owner@192.0.2.2'
    assert 'observe' in calls[0][-1]


def test_refusal_releases_claim_but_a_lost_stop_reply_keeps_it_until_observed(tmp_path):
    owner = Owner('fixture', 'web')
    store = OperationStore(tmp_path / 'operations.sqlite')
    row = store.prepare(owner, request_key='first', request_ref='first', action='stop_workload', spark='spark2', container=CONTAINER)
    store.confirm(owner, row['id'], row['digest'])
    def refuse(*a): raise NotDispatched('A protected service must keep running.')
    assert store.run(owner, row['id'], dispatch=refuse, observe=lambda *a: pytest.fail('No send needs no observation'))['state'] == 'failed'
    second = store.prepare(owner, request_key='second', request_ref='second', action='stop_workload', spark='spark2', container=CONTAINER)
    store.confirm(owner, second['id'], second['digest'])
    sends = []
    def timeout(*a): sends.append(a); raise TimeoutError()
    assert store.run(owner, second['id'], dispatch=timeout, observe=lambda *a: 'unknown')['state'] == 'uncertain'
    assert store.reconcile(second['id'], observe=lambda *a: 'succeeded')['state'] == 'succeeded'
    assert len(sends) == 1


def test_inspection_and_stop_use_local_daemon_and_empty_private_config(tmp_path, monkeypatch):
    ambient = tmp_path / 'ambient'
    ambient.mkdir()
    (ambient / 'config.json').write_text('{"currentContext":"other-host","proxies":{"default":{"httpProxy":"synthetic-secret"}}}')
    monkeypatch.setenv('DOCKER_HOST', 'ssh://owner@other-machine')
    monkeypatch.setenv('DOCKER_CONTEXT', 'other-host')
    monkeypatch.setenv('DOCKER_CONFIG', str(ambient))
    seen = []
    def runner(args, **kwargs):
        seen.append(args)
        assert args[:2] == ['docker', '--config'] and args[3:5] == ['--host', 'unix:///var/run/docker.sock']
        config = Path(args[2])
        assert config != ambient and config.is_dir() and not list(config.iterdir())
        assert stat.S_IMODE(config.stat().st_mode) == 0o700
        assert not any(key.startswith('DOCKER_') for key in kwargs['env'])
        return Result(returncode=0, stdout='\n'.join(map(json.dumps, [CONTAINER, '/job', True, None])))
    result = handle(REQUEST, hostname='compute-fixture', runner=runner)
    assert result['status'] == 'sent' and len(seen) == 2
    assert [args[5] for args in seen] == ['inspect', 'stop']
    assert all(not Path(args[2]).exists() for args in seen)
