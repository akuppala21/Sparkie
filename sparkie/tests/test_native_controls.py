"""Native authenticated HTTP + real Telegram dispatch, with stand-in effects only.

No bot traffic, model, fleet credential or SSH call is used by these tests.
"""

import asyncio
from datetime import datetime, timezone
import json
from pathlib import Path
import secrets
import shutil
import sqlite3

import pytest

from sparkie_sparks.authority import OwnerBinding
from sparkie_sparks.controls import Controls
from sparkie_sparks.operations import OperationStore

pytestmark = pytest.mark.integration
USER = 12345


@pytest.fixture
def rig(tmp_path, monkeypatch):
    home = tmp_path / 'hermes'
    home.mkdir(mode=0o700)
    monkeypatch.setenv('HERMES_HOME', str(home))
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from hermes_cli.dashboard_auth import clear_providers, register_provider
    from hermes_cli.dashboard_auth.middleware import gated_auth_middleware
    from plugins.dashboard_auth.basic import BasicAuthProvider, hash_password
    from sparkie_sparks import controls
    from sparkie_sparks.web_controls import router

    binding = [OwnerBinding('generation-1', 'fixture-owner', 'basic', '', USER, USER)]
    effects, outcomes = [], ['succeeded']
    now = [1000]
    store = OperationStore(tmp_path / 'operations.sqlite', clock=lambda: now[0])
    service = Controls(store, binding=lambda: binding[0], dispatch=lambda *a: effects.append(a),
                       observe=lambda *a: outcomes[0])
    monkeypatch.setattr(controls, '_controls', service)
    clear_providers()
    provider = BasicAuthProvider(username='fixture-owner', password_hash=hash_password('fixture-password'),
                                 secret=secrets.token_bytes(32))
    register_provider(provider)
    signed = provider.complete_password_login(username='fixture-owner', password='fixture-password')
    app = FastAPI()
    app.state.auth_required = True
    app.middleware('http')(gated_auth_middleware)
    app.include_router(router, prefix='/api/plugins/sparkie-sparks')
    with TestClient(app, base_url='https://fixture.invalid') as client:
        client.headers['Authorization'] = 'Bearer ' + signed.access_token
        yield dict(service=service, store=store, binding=binding, effects=effects, outcomes=outcomes,
                   now=now, client=client, provider=provider, signed=signed, monkeypatch=monkeypatch)
    clear_providers()


def prepare(rig, **extra):
    response = rig['client'].post('/api/plugins/sparkie-sparks/operations', json={
        'request_id': 'a' * 32, 'action': 'wake', 'spark': 'spark2', **extra})
    assert response.status_code == 200, response.text
    return response.json()


def test_native_web_requires_verified_owner_and_exact_one_use_confirmation(rig):
    client = rig['client']
    row = prepare(rig)
    assert row['can_confirm'] and rig['effects'] == []
    assert prepare(rig)['id'] == row['id']
    url = '/api/plugins/sparkie-sparks/operations/' + row['id'] + '/confirm'
    assert client.post(url, json={'digest': '0' * 64}).status_code == 403
    assert client.post(url, json={'digest': row['digest'], 'approved': True}).status_code == 422
    result = client.post(url, json={'digest': row['digest']})
    assert result.status_code == 200 and result.json()['state'] == 'succeeded'
    assert client.post(url, json={'digest': row['digest']}).status_code == 403
    assert len(rig['effects']) == 1
    rig['provider'].revoke_access_session(access_token=rig['signed'].access_token)
    assert client.get('/api/plugins/sparkie-sparks/controls').status_code == 401


def test_web_cannot_use_model_identity_or_cross_site_cookie_to_confirm(rig):
    client = rig['client']
    row = prepare(rig)
    url = '/api/plugins/sparkie-sparks/operations/' + row['id'] + '/confirm'
    del client.headers['Authorization']
    assert client.post(url, json={'digest': row['digest']}).status_code == 401
    client.cookies.set('__Host-hermes_session_at', rig['signed'].access_token)
    assert client.post(url, json={'digest': row['digest']}, headers={'Sec-Fetch-Site': 'cross-site'}).status_code == 403
    assert rig['effects'] == []
    assert client.post(url, json={'digest': row['digest']}, headers={'Sec-Fetch-Site': 'same-origin'}).json()['state'] == 'succeeded'


def test_owner_change_expiry_uncertainty_and_cancel_work_without_the_model(rig):
    row = prepare(rig)
    base = '/api/plugins/sparkie-sparks/operations/' + row['id']
    rig['binding'][0] = OwnerBinding('generation-2', 'fixture-owner', 'basic', '', USER, USER)
    assert rig['client'].post(base + '/confirm', json={'digest': row['digest']}).status_code == 403
    rig['binding'][0] = OwnerBinding('generation-1', 'fixture-owner', 'basic', '', USER, USER)
    rig['now'][0] = row['expires']
    assert rig['client'].post(base + '/confirm', json={'digest': row['digest']}).status_code == 403
    assert rig['effects'] == []
    row = prepare(rig, request_id='b' * 32)
    base = '/api/plugins/sparkie-sparks/operations/' + row['id']
    rig['outcomes'][0] = 'unknown'
    assert rig['client'].post(base + '/confirm', json={'digest': row['digest']}).json()['state'] == 'uncertain'
    cancelled = rig['client'].post(base + '/cancel').json()
    assert cancelled['state'] == 'uncertain' and cancelled['cancel_requested']
    rig['outcomes'][0] = 'succeeded'
    assert rig['client'].post(base + '/check').json()['state'] == 'succeeded'
    assert len(rig['effects']) == 1


def test_busy_spark_does_not_consume_native_owner_confirmation(rig):
    first = prepare(rig)
    rig['outcomes'][0] = 'unknown'
    base = '/api/plugins/sparkie-sparks/operations/'
    assert rig['client'].post(base + first['id'] + '/confirm', json={'digest': first['digest']}).json()['state'] == 'uncertain'
    second = prepare(rig, request_id='b' * 32)
    assert rig['client'].post(base + second['id'] + '/confirm', json={'digest': second['digest']}).status_code == 409
    saved = rig['store'].get(second['id'])
    assert saved['state'] == 'pending' and saved['approved_at'] is None
    assert rig['client'].get(base + second['id']).json()['can_confirm'] is True
    assert len(rig['effects']) == 1
    rig['outcomes'][0] = 'succeeded'
    assert rig['client'].post(base + first['id'] + '/check').json()['state'] == 'succeeded'
    assert rig['client'].post(base + second['id'] + '/confirm', json={'digest': second['digest']}).json()['state'] == 'succeeded'
    assert len(rig['effects']) == 2
    assert rig['client'].post(base + second['id'] + '/confirm', json={'digest': second['digest']}).status_code == 403


def test_recovery_result_is_identical_in_native_web_and_telegram_without_model(rig):
    from telegram import Update
    from sparkie_sparks.controls import result_text
    from sparkie_sparks.telegram_controls import register

    async def run():
        app, wire = telegram_fixture()
        register(app, None)
        async with app:
            row = prepare(rig, action='stop_workload', container='a' * 64)
            url = '/api/plugins/sparkie-sparks/operations/' + row['id']
            rig['outcomes'][0] = 'unknown'
            shown = rig['client'].post(url + '/confirm', json={'digest': row['digest']}).json()
            assert shown['recovery']['retry_policy'] == 'keep_request'
            assert shown['recovery']['operation_terminal'] is False
            await app.process_update(Update.de_json({'update_id': 1, 'message': {
                'message_id': 1, 'date': 1, 'chat': {'id': USER, 'type': 'private'},
                'from': {'id': USER, 'is_bot': False, 'first_name': 'Fixture'},
                'text': '/spark show ' + row['id'],
                'entities': [{'type': 'bot_command', 'offset': 0, 'length': 6}],
            }}, app.bot))
            card = wire.messages[-1]
            assert card['text'] == result_text(shown)
            assert 'Run it' not in json.dumps(card.get('reply_markup'))
            button = next(button['callback_data'] for line in card['reply_markup']['inline_keyboard']
                          for button in line if button['text'] == 'Check result')
            rig['outcomes'][0] = 'failed'
            await app.process_update(Update.de_json({'update_id': 2, 'callback_query': {
                'id': 'recovery-query', 'chat_instance': 'fixture', 'data': button, 'message': card,
                'from': {'id': USER, 'is_bot': False, 'first_name': 'Fixture'},
            }}, app.bot))
            failed = rig['client'].get(url).json()
            assert failed['state'] == 'failed' and failed['recovery']['operation_terminal'] is True
            assert failed['recovery']['retry_policy'] == 'review_required'
            assert wire.messages[-1]['text'] == result_text(failed)
            assert not wire.messages[-1].get('reply_markup')
            assert rig['client'].post(url + '/confirm', json={'digest': row['digest']}).status_code == 403
            assert len(rig['effects']) == 1
    asyncio.run(run())


def test_unconfigured_controls_fail_closed_and_never_offer_a_model_approval_tool(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from hermes_cli.plugins import PluginManager
    from tools.registry import registry
    from sparkie_sparks import controls
    from sparkie_sparks.web_controls import router
    monkeypatch.setattr(controls, '_controls', None)
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        assert client.get('/controls').json()['available'] is False
        assert client.post('/operations', json={'request_id': 'a' * 32, 'action': 'wake', 'spark': 'spark2'}).status_code == 409
    home = tmp_path / 'hermes'
    shutil.copytree(Path(__file__).resolve().parents[1] / 'plugin', home / 'plugins/sparkie-sparks')
    (home / 'config.yaml').write_text('plugins:\n  enabled: [sparkie-sparks]\n')
    monkeypatch.setenv('HERMES_HOME', str(home))
    manager = PluginManager(scope_key=str(home))
    manager.discover_and_load()
    assert len(manager.get_platform_handler_factories('telegram')) == 1
    for name in ('spark_confirm', 'spark_confirm_operation', 'spark_owner'):
        assert registry.get_entry(name, scope=manager.scope_key) is None


def test_native_memory_guard_refuses_removal_and_leaves_additions_and_corrections(tmp_path, monkeypatch):
    home = tmp_path / 'hermes'
    shutil.copytree(Path(__file__).resolve().parents[1] / 'plugin', home / 'plugins/sparkie-sparks')
    (home / 'config.yaml').write_text('plugins:\n  enabled: [sparkie-sparks]\n')
    monkeypatch.setenv('HERMES_HOME', str(home))
    from hermes_cli.plugins import discover_plugins, get_pre_tool_call_block_message
    discover_plugins(force=True)
    add = {'action': 'add', 'content': 'ordinary note'}
    patch = {'action': 'patch', 'old_text': 'former', 'content': 'current'}
    remove = {'action': 'remove', 'old_text': 'synthetic-private-marker'}
    for args in (remove, {'operations': [add, remove]}, {**patch, 'content': ' '}):
        blocked = get_pre_tool_call_block_message('memory', args)
        assert 'owner confirmation' in blocked
        assert 'synthetic-private-marker' not in blocked
    for args in (add, patch, {'operations': [add, patch]}):
        assert get_pre_tool_call_block_message('memory', args) is None


def telegram_fixture():
    from telegram.ext import Application
    from telegram.request import BaseRequest

    class MemoryRequest(BaseRequest):
        def __init__(self):
            self.calls, self.messages = [], []
            self.fail_send = False
        @property
        def read_timeout(self): return 5
        async def initialize(self): pass
        async def shutdown(self): pass
        async def do_request(self, url, method, request_data=None, **kwargs):
            name = url.rsplit('/', 1)[-1]
            params = request_data.parameters if request_data else {}
            self.calls.append((name, params))
            if name == 'getMe':
                result = {'id': 999, 'is_bot': True, 'first_name': 'Fixture', 'username': 'FixtureBot'}
            elif name == 'sendMessage':
                if self.fail_send:
                    from telegram.error import NetworkError
                    raise NetworkError('Fixture delivery was unavailable')
                result = {'message_id': 100 + len(self.messages), 'date': 1,
                          'chat': {'id': int(params['chat_id']), 'type': 'private'},
                          'from': {'id': 999, 'is_bot': True, 'first_name': 'Fixture'}, 'text': params['text']}
                if params.get('reply_markup'):
                    result['reply_markup'] = params['reply_markup']
                self.messages.append(result)
            elif name == 'answerCallbackQuery':
                result = True
            else:
                raise AssertionError('Unexpected Telegram request: ' + name)
            return 200, json.dumps({'ok': True, 'result': result}).encode()

    request = MemoryRequest()
    app = Application.builder().token('999:fixture-only').request(request).updater(None).build()
    return app, request


def test_native_telegram_dispatch_shares_web_operations_binds_messages_and_rejects_replay(rig):
    from telegram import Update
    from telegram.ext import CallbackQueryHandler
    from sparkie_sparks.telegram_controls import register

    async def run():
        app, wire = telegram_fixture()
        register(app, None)
        unhandled = []
        errors = []
        async def capture_error(update, context): errors.append(context.error)
        app.add_error_handler(capture_error)
        async def core(update, ctx): unhandled.append(update.callback_query.data)
        app.add_handler(CallbackQueryHandler(core))
        async with app:
            async def message(text, *, user=USER, number=1, group=False):
                data = {'update_id': number, 'message': {'message_id': number, 'date': 1,
                    'chat': {'id': -1 if group else user, 'type': 'group' if group else 'private'},
                    'from': {'id': user, 'is_bot': False, 'first_name': 'Fixture'}, 'text': text,
                    'entities': [{'type': 'bot_command', 'offset': 0, 'length': 6}]}}
                await app.process_update(Update.de_json(data, app.bot))
            async def click(data, card, *, user=USER):
                await app.process_update(Update.de_json({'update_id': 999, 'callback_query': {
                    'id': 'fixture-query', 'chat_instance': 'fixture', 'data': data,
                    'from': {'id': user, 'is_bot': False, 'first_name': 'Fixture'}, 'message': card}}, app.bot))

            row = prepare(rig)
            await message('/spark show ' + row['id'])
            card = wire.messages[-1]
            button = card['reply_markup']['inline_keyboard'][0][0]['callback_data']
            assert len(button.encode()) <= 64 and row['description'] in card['text']
            await click(button, {**card, 'message_id': card['message_id'] + 1000})
            await click(button, card, user=54321)
            assert rig['effects'] == []
            await click(button, card)
            assert len(rig['effects']) == 1
            assert rig['store'].get(row['id'])['approved_channel'] == 'telegram'
            await click(button, card)
            assert len(rig['effects']) == 1
            assert 'already used' in wire.calls[-1][1]['text']
            await click('native:unrelated', card)
            assert unhandled == ['native:unrelated']

            await message('/spark wake spark3', number=20)
            await message('/spark wake spark3', number=20)
            pending = rig['store'].recent(rig['binding'][0].telegram(Update.de_json({
                'update_id': 1, 'message': {'message_id': 1, 'date': 1, 'chat': {'id': USER, 'type': 'private'},
                'from': {'id': USER, 'is_bot': False, 'first_name': 'Fixture'}}}, app.bot)))
            assert len(pending) == 2
            for args in ({'user': 54321}, {'group': True}):
                await message('/spark wake spark4', number=21, **args)
            await message('/spark sleep spark1', number=22)
            assert len(rig['effects']) == 1
            with sqlite3.connect(rig['store'].path) as db:
                assert db.execute('SELECT count(*) FROM operations').fetchone()[0] == 2
            assert errors == [], errors
    asyncio.run(run())


def test_private_broker_reads_cannot_block_the_telegram_event_loop(rig):
    from threading import Event
    from telegram import Update
    from sparkie_sparks.telegram_controls import register

    async def run():
        loop = asyncio.get_running_loop()
        def delayed_binding():
            # A read can complete only after this event loop has serviced another
            # task. Calling it on the loop itself would prevent that progress.
            ready = Event()
            loop.call_soon_threadsafe(ready.set)
            if not ready.wait(2):
                raise RuntimeError('The private read blocked Telegram.')
            return rig['binding'][0]
        rig['service'].binding = delayed_binding
        app, wire = telegram_fixture()
        register(app, None)
        async with app:
            await app.process_update(Update.de_json({'update_id': 1, 'message': {
                'message_id': 1, 'date': 1, 'chat': {'id': USER, 'type': 'private'},
                'from': {'id': USER, 'is_bot': False, 'first_name': 'Fixture'},
                'text': '/spark wake spark2', 'entities': [{'type': 'bot_command', 'offset': 0, 'length': 6}]
            }}, app.bot))
            card = wire.messages[-1]
            assert 'Waiting for your confirmation' in card['text']
            button = card['reply_markup']['inline_keyboard'][0][0]['callback_data']
            await app.process_update(Update.de_json({'update_id': 2, 'callback_query': {
                'id': 'responsive-query', 'chat_instance': 'fixture', 'data': button,
                'from': {'id': USER, 'is_bot': False, 'first_name': 'Fixture'}, 'message': card
            }}, app.bot))
            assert len(rig['effects']) == 1
            assert 'requested result was observed' in wire.messages[-1]['text']
    asyncio.run(run())


def test_erasure_reuses_owner_channel_confirmation_without_retain_text(rig, tmp_path, monkeypatch):
    import os
    from contextlib import closing
    from threading import Thread
    from hermes_state import SessionDB
    from tools.memory_tool import load_on_disk_store
    from telegram import Update
    from telegram.ext import MessageHandler, TypeHandler, filters
    from sparkie_sparks import controls
    from sparkie_sparks.authority import Owner
    from sparkie_sparks.broker import FleetServer, RemoteControls
    from sparkie_sparks.composition import compose
    from sparkie_sparks.telegram_controls import register

    home = Path(os.environ['HERMES_HOME'])
    web_literal, telegram_literal = 'nativeEraseWebA48', 'nativeEraseTelegramB32'
    memory = load_on_disk_store()
    assert memory.add('user', 'First fixture: ' + web_literal)['success']
    assert memory.add('user', 'Second fixture: ' + telegram_literal)['success']
    with closing(SessionDB(db_path=home / 'state.db')) as db:
        db.create_session('memory-fixture', source='telegram')
        db.append_message('memory-fixture', role='user', content=f'Owner fixture {web_literal}, {telegram_literal}')
        assert db.search_messages(web_literal)

    prepare_url = '/api/plugins/sparkie-sparks/memory/erase'
    operation_url = '/api/plugins/sparkie-sparks/operations/'
    client = rig['client']
    owner = Owner(rig['binding'][0].generation, 'web')
    nodes = [{'id': 'spark1', 'hostname': 'fixture-host', 'address': '127.0.0.1', 'user': 'owner'}]
    controller = compose(rig['store'], nodes, binding=lambda: rig['binding'][0], memory_home=home)
    path = tmp_path / 'private' / 'fleet.sock'
    monkeypatch.setattr(controls, '_controls', RemoteControls(path))

    async def exercise():
        app, wire = telegram_fixture()
        register(app, None)
        ingress = []
        errors = []

        async def core(update, _):
            ingress.append(update.effective_message.text)

        async def capture_error(_, context):
            errors.append(context.error)

        app.add_handler(MessageHandler(filters.COMMAND, core))
        app.add_handler(TypeHandler(Update, core), group=99)
        app.add_error_handler(capture_error)
        async with app:
            async def message(text, number, *, user=USER):
                await app.process_update(Update.de_json({'update_id': number, 'message': {
                    'message_id': number, 'date': 1, 'chat': {'id': user, 'type': 'private'},
                    'from': {'id': user, 'is_bot': False, 'first_name': 'Fixture'}, 'text': text,
                    'entities': [{'type': 'bot_command', 'offset': 0, 'length': len(text.split()[0])}],
                }}, app.bot))

            async def confirm(card, *, user=USER):
                data = card['reply_markup']['inline_keyboard'][0][0]['callback_data']
                await app.process_update(Update.de_json({'update_id': 9, 'callback_query': {
                    'id': 'memory-query', 'chat_instance': 'fixture', 'data': data, 'message': card,
                    'from': {'id': user, 'is_bot': False, 'first_name': 'Fixture'},
                }}, app.bot))

            body = {'request_id': 'a' * 32, 'target': 'user', 'literal': web_literal}
            assert client.post(prepare_url + '?profile=work', json=body).status_code == 400
            row = client.post(prepare_url, json=body).json()
            assert row['can_confirm'] and row['intent'] == {'action': 'erase_memory'}
            assert '1 searchable messages' in row['description']
            assert web_literal not in json.dumps(row)
            assert web_literal in (home / 'memories/USER.md').read_text()
            url = operation_url + row['id'] + '/confirm'
            assert client.post(url, json={'digest': '0' * 64}).status_code == 403
            await message('/spark show ' + row['id'], 1)
            card = wire.messages[-1]
            await confirm(card, user=54321)
            assert rig['store'].get(row['id'])['state'] == 'pending'
            await confirm(card)
            assert rig['store'].get(row['id'])['approved_channel'] == 'telegram'
            assert rig['store'].get(row['id'])['state'] == 'succeeded'
            assert client.post(url, json={'digest': row['digest']}).status_code == 403
            repeated = client.post(prepare_url, json=body).json()
            assert repeated['id'] == row['id'] and repeated['state'] == 'succeeded'
            assert client.post(prepare_url, json={**body, 'literal': telegram_literal}).status_code == 400
            await confirm(card)

            wire.fail_send = True
            await message('/memoryerase user ' + telegram_literal, 2, user=54321)
            wire.fail_send = False
            assert len(controller.recent(owner)) == 1
            await message('/memoryerase user ' + telegram_literal, 3)
            pending = [operation for operation in controller.recent(owner) if operation['can_confirm']]
            assert len(pending) == 1
            second = pending[0]
            second_url = operation_url + second['id'] + '/confirm'
            assert client.post(second_url + '?profile=work', json={'digest': second['digest']}).status_code == 400
            assert client.post(second_url, json={'digest': second['digest']}).json()['state'] == 'succeeded'
            assert rig['store'].get(second['id'])['approved_channel'] == 'web'
            assert all(not value or 'memoryerase' not in value for value in ingress)
            assert not errors
            assert all(literal not in json.dumps(wire.messages) for literal in (web_literal, telegram_literal))

    with FleetServer(path, controller, gateway_uid=os.geteuid()) as server:
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            asyncio.run(exercise())
        finally:
            server.shutdown()
            thread.join(2)
    assert all(literal.encode() not in rig['store'].path.read_bytes() for literal in (web_literal, telegram_literal))
    with closing(SessionDB(db_path=home / 'state.db')) as db:
        for literal in (web_literal, telegram_literal):
            assert not db.search_messages(literal, include_inactive=True)
            assert literal not in (home / 'memories/USER.md').read_text()


def test_schema_one_receipts_survive_upgrade_with_claims_intact(tmp_path):
    from sparkie_sparks.operations import SCHEMA
    path = tmp_path / 'operations.sqlite'
    with sqlite3.connect(path) as db:
        db.executescript(SCHEMA.split('CREATE TABLE telegram_cards')[0] + 'PRAGMA user_version=1;')
        db.execute('INSERT INTO claims VALUES (?,?)', ('spark2', 'held-operation'))
    OperationStore(path)
    with sqlite3.connect(path) as db:
        assert db.execute('PRAGMA user_version').fetchone()[0] == 2
        assert db.execute('SELECT operation FROM claims').fetchone()[0] == 'held-operation'
