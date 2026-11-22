"""Real adapter composition and broker configuration with no hardware effects."""
from dataclasses import asdict, replace
import json
import os
import subprocess
import sys
import time
from threading import Thread

import pytest

from sparkie_sparks.authority import Owner, OwnerBinding
from sparkie_sparks.broker import FleetServer, RemoteControls
from sparkie_sparks.composition import compose
from sparkie_sparks.operations import NotDispatched
from test_power import HUB, MAPPING, NODE, OWNER, rig

pytestmark = pytest.mark.integration
BINDING = OwnerBinding(OWNER.generation, 'owner', 'basic', '', 12345, 12345)


def test_generation_revoked_during_plug_observation_cannot_send_wake(tmp_path):
    store, meter, transport, power = rig(tmp_path)
    binding = [BINDING]
    controls = compose(store, [NODE], binding=lambda: binding[0], power=power)
    row = controls.prepare(OWNER, request_key='revoke', request_ref='fixture', action='wake', spark='spark2')
    observe = meter.observe
    def revoked(spark):
        binding[0] = replace(BINDING, generation='replacement-owner')
        return observe(spark)
    meter.observe = revoked
    assert controls.confirm(OWNER, row['id'], row['digest'])['state'] == 'failed'
    assert meter.sent == []


def test_composed_dispatch_rechecks_generation_and_cancellation(tmp_path):
    store, meter, transport, power = rig(tmp_path)
    binding = [BINDING]
    controls = compose(store, [NODE], binding=lambda: binding[0], power=power)
    row = controls.prepare(OWNER, request_key='dispatch', request_ref='fixture', action='wake', spark='spark2')
    def dispatch(operation, target):
        binding[0] = replace(BINDING, generation='replacement-owner')
        controls.dispatch(operation, target)
    outcome = store.run(OWNER, row['id'], approval_digest=row['digest'], dispatch=dispatch, observe=power.observe)
    assert outcome['state'] == 'failed' and meter.sent == [] and transport.calls == []


def test_global_capabilities_match_real_connected_adapter_actions(tmp_path):
    store, meter, transport, power = rig(tmp_path)
    controls = compose(store, [NODE], binding=lambda: BINDING, power=power)
    capabilities = controls.capabilities(OWNER)
    expected = sorted({action for row in capabilities['by_spark'].values() for action in row['actions']})
    assert capabilities['by_spark']['spark2']['actions'] == ['stop_workload', 'wake']
    assert capabilities['by_spark']['spark3']['actions'] == []
    assert capabilities['actions'] == expected
    assert meter.sent == [] and transport.calls == []


def test_private_clients_share_real_composed_power_approval_and_observation(tmp_path):
    store, meter, transport, power = rig(tmp_path)
    controls = compose(store, [NODE], binding=lambda: BINDING, power=power)
    path = tmp_path / 'private/fleet.sock'
    with FleetServer(path, controls, gateway_uid=os.geteuid()) as server:
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            web, telegram = RemoteControls(path), RemoteControls(path)
            web_owner = Owner(OWNER.generation, 'web')
            row = web.prepare(web_owner, request_key='composed', request_ref='fixture', action='wake', spark='spark2')
            assert meter.sent == []
            with pytest.raises(PermissionError):
                telegram.confirm(OWNER, row['id'], '0' * 64)
            assert meter.sent == []
            assert telegram.confirm(OWNER, row['id'], row['digest'])['state'] == 'succeeded'
            assert web.get(web_owner, row['id'])['state'] == 'succeeded'
            with pytest.raises(PermissionError):
                web.confirm(web_owner, row['id'], row['digest'])
            for action, spark in [('sleep', 'spark2'), ('wake', 'spark3'), ('wake', 'spark1')]:
                with pytest.raises(ValueError):
                    web.prepare(web_owner, request_key=action + spark, request_ref='fixture', action=action, spark=spark)
            assert meter.sent == [('on', 'spark2')]
            assert transport.calls == ['inspect']
            assert store.get(row['id'])['approved_channel'] == 'telegram'
        finally:
            server.shutdown()
            thread.join(2)


def test_optional_power_config_starts_wake_only_without_hardware_access(tmp_path):
    paths = {name: tmp_path / (name + '.json') for name in ('binding', 'inventory', 'mapping', 'config')}
    path = tmp_path / 'private/fleet.sock'
    documents = {
        'binding': asdict(BINDING),
        'inventory': {'schema': 1, 'nodes': [NODE]},
        'mapping': MAPPING,
        'config': {'schema': 1, 'owner_binding': str(paths['binding']), 'inventory': str(paths['inventory']),
                   'operations': str(tmp_path / 'operations.sqlite'), 'socket': str(path),
                   'gateway_uid': os.geteuid(), 'power': {'nodes': ['spark2'], 'mapping': str(paths['mapping']),
                                                         'hub_machine_id': HUB}},
    }
    for name, document in documents.items():
        paths[name].write_text(json.dumps(document))
        paths[name].chmod(0o600)
    process = subprocess.Popen([sys.executable, '-m', 'sparkie_sparks.broker', '--config', str(paths['config'])],
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        deadline = time.monotonic() + 10
        while not path.exists():
            assert process.poll() is None, process.communicate()
            assert time.monotonic() < deadline, 'Private broker did not start'
            time.sleep(.02)
        remote = RemoteControls(path)
        capabilities = remote.capabilities(OWNER)
        assert capabilities['by_spark']['spark2']['actions'] == ['stop_workload', 'wake']
        assert capabilities['by_spark']['spark3']['actions'] == []
        assert capabilities['by_spark']['spark4']['actions'] == []
        with pytest.raises(ValueError):
            remote.prepare(OWNER, request_key='sleep', request_ref='fixture', action='sleep', spark='spark2')
        assert remote.recent(OWNER) == []
    finally:
        process.terminate()
        process.communicate(timeout=5)
    assert process.returncode == 0 and not path.exists()
