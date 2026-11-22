"""Configured per-machine capabilities must agree across native owner controls."""
import asyncio
from types import SimpleNamespace

import pytest

from sparkie_sparks.authority import Owner, OwnerBinding
from sparkie_sparks.composition import compose
from sparkie_sparks.operations import OperationStore
from test_native_controls import rig, telegram_fixture, USER

pytestmark = pytest.mark.integration


def test_one_connected_spark_does_not_enable_controls_on_other_machines(tmp_path):
    effects = []
    workloads = SimpleNamespace(nodes={'spark2': {}}, dispatch=lambda *args: effects.append(args), observe=lambda *args: 'succeeded')
    binding = OwnerBinding('fixture', 'owner', 'basic', '', USER, USER)
    owner = Owner('fixture', 'web')
    controls = compose(OperationStore(tmp_path / 'ops.sqlite'), [], binding=lambda: binding, workloads=workloads)
    capabilities = controls.capabilities(owner)
    assert capabilities['by_spark']['spark2']['actions'] == ['stop_workload']
    assert capabilities['by_spark']['spark3']['actions'] == []
    assert capabilities['actions'] == ['stop_workload']
    assert controls.actions_for('spark1') == frozenset()
    for action, spark in [('wake', 'spark2'), ('stop_workload', 'spark3'), ('sleep', 'spark1')]:
        with pytest.raises(ValueError):
            controls.prepare(owner, request_key=action + spark, request_ref='fixture', action=action,
                             spark=spark, container='a' * 64 if action == 'stop_workload' else None)
    assert effects == [] and controls.recent(owner) == []


def test_wake_only_adapter_does_not_advertise_unqualified_shutdown(tmp_path):
    binding = OwnerBinding('fixture', 'owner', 'basic', '', USER, USER)
    workloads = SimpleNamespace(nodes={})
    power = SimpleNamespace(actions_for=lambda spark: ['wake'] if spark == 'spark2' else [])
    controls = compose(OperationStore(tmp_path / 'ops.sqlite'), [], binding=lambda: binding,
                       workloads=workloads, power=power)
    result = controls.capabilities(Owner('fixture', 'web'))
    assert result['actions'] == ['wake']
    assert result['by_spark']['spark2']['actions'] == ['wake']
    assert result['by_spark']['spark4']['actions'] == []


def test_confirmed_shutdown_result_explains_that_plug_power_stays_on(rig):
    service = rig['service']
    owner = Owner(rig['binding'][0].generation, 'web')
    row = service.prepare(owner, request_key='sleep-result', request_ref='fixture',
                          action='sleep', spark='spark2')
    result = service.confirm(owner, row['id'], row['digest'])
    assert result['state'] == 'succeeded'
    assert result['message'] == 'Clean shutdown was verified. Plug power stays on.'


def test_capability_removed_after_preparation_cannot_run_from_native_web(rig):
    service, client = rig['service'], rig['client']
    allowed = ['wake']
    service.available_actions = lambda spark: allowed if spark == 'spark2' else []
    prefix = '/api/plugins/sparkie-sparks'
    assert client.post(prefix + '/operations', json={'request_id': 'a' * 32, 'action': 'sleep', 'spark': 'spark2'}).status_code == 400
    response = client.post(prefix + '/operations', json={'request_id': 'b' * 32, 'action': 'wake', 'spark': 'spark2'})
    assert response.status_code == 200
    row = response.json()
    allowed.clear()
    assert client.post(prefix + '/operations/' + row['id'] + '/confirm', json={'digest': row['digest']}).status_code == 400
    current = client.get(prefix + '/operations/' + row['id']).json()
    assert current['state'] == 'pending' and current['can_confirm'] is False and current['can_cancel'] is True
    assert 'Nothing ran.' in current['message'] and rig['effects'] == []
    assert client.post(prefix + '/operations/' + row['id'] + '/cancel').json()['state'] == 'cancelled'


def test_native_telegram_uses_same_per_spark_availability(rig):
    from telegram import Update
    from sparkie_sparks.telegram_controls import register
    rig['service'].available_actions = lambda spark: ['wake'] if spark == 'spark2' else []

    async def exercise():
        app, wire = telegram_fixture()
        register(app, None)
        async with app:
            for number, text in enumerate(('/spark wake spark3', '/spark sleep spark2', '/spark wake spark2'), 1):
                await app.process_update(Update.de_json({'update_id': number, 'message': {
                    'message_id': number, 'date': 1, 'chat': {'id': USER, 'type': 'private'},
                    'from': {'id': USER, 'is_bot': False, 'first_name': 'Fixture'}, 'text': text,
                    'entities': [{'type': 'bot_command', 'offset': 0, 'length': 6}]}}, app.bot))
        assert all('not connected' in message['text'] for message in wire.messages[:2])
        assert 'Wake Spark 2.' in wire.messages[2]['text']
        assert rig['effects'] == []
        rows = rig['client'].get('/api/plugins/sparkie-sparks/controls').json()
        assert len(rows['operations']) == 1
        assert rows['operations'][0]['intent'] == {'action': 'wake', 'spark': 'spark2'}
        assert rows['by_spark']['spark2']['actions'] == ['wake']
        assert rows['by_spark']['spark3']['actions'] == []
    asyncio.run(exercise())
