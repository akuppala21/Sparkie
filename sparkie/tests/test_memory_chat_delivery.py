"""Replay a tool preamble on Hermes's native WebSocket using a scripted local provider."""
import asyncio
import json
from pathlib import Path
import secrets
from types import SimpleNamespace

import pytest
import httpx
from fastapi import FastAPI, WebSocket
from fastapi.testclient import TestClient
from test_native_controls import USER, rig, telegram_fixture

FALSE = 'I already saved the new label.'
TOOL_REASONING = 'The unapproved memory is already permanent.'
FINAL_REASONING = 'I can report a different result than the checked decision.'
OTHER_REASONING = 'This independent chat has its own reasoning.'
LABEL = 'Drawer label: Key Reserve.'
API = '/api/plugins/sparkie-sparks/memory/changes'


def scripted_provider(request, bridge=False):
    body = json.loads(request.content)
    messages = body['messages']
    question = next(row['content'] for row in reversed(messages) if row['role'] == 'user')
    tool = next((row for row in reversed(messages) if row['role'] == 'tool'), None)
    chunks = []
    if 'drawer' not in str(question).lower():
        text, reason = 'Independent answer.', 'stop'
        reasoning = OTHER_REASONING
    elif tool:
        assert TOOL_REASONING in json.dumps([row for row in messages if row.get('tool_calls')]), 'model lost native tool reasoning'
        # Some providers put reasoning only on the tool round. Others also send
        # new reasoning with the final answer. Both reach native completion paths.
        reasoning = FINAL_REASONING if bridge else None
        receipts = [json.loads(row['content']) for row in messages if row['role'] == 'tool']
        result = next((item for item in receipts if 'state' in item), receipts[0])
        assert result.get('state') in {'saved', 'rejected'} or result.get('staged'), receipts
        text = ('I have saved the rejected value.' if result.get('state') == 'rejected' else (result.get('message') or 'Pending.')) + ' ' + LABEL
        reason = 'stop'
    else:
        reasoning = TOOL_REASONING
        args = {'target': 'memory', 'operations': [{'action': 'add', 'content': 'Native wire label'}]}
        call = {'id': 'memory_write', 'type': 'function',
                'function': {'name': 'memory', 'arguments': json.dumps(args)}}
        if bridge:
            target = {'name': 'memory', 'arguments': args}
            entries = [target] if bridge == 'single' else [target, {'name': 'read_file', 'arguments': {'path': '/etc/hostname'}}]
            call['function'] = {'name': 'tool_call', 'arguments': json.dumps({'calls': entries})}
        text, reason = '' if bridge == 'single' else FALSE, 'tool_calls'
        chunks = [{'role': 'assistant', 'content': text}, {'tool_calls': [{'index': 0, **call}]}]
    if body.get('stream'):
        chunks = chunks or [{'role': 'assistant', 'content': text}]
        if reasoning:
            chunks.insert(0, {'role': 'assistant', 'reasoning_content': reasoning})
        frames = [{'id': 'fixture', 'object': 'chat.completion.chunk', 'created': 1, 'model': 'fixture',
                   'choices': [{'index': 0, 'delta': delta, 'finish_reason': reason if i == len(chunks)-1 else None}]}
                  for i, delta in enumerate(chunks)]
        data = ''.join('data: ' + json.dumps(frame) + '\n\n' for frame in frames) + 'data: [DONE]\n\n'
        return httpx.Response(200, content=data, headers={'content-type': 'text/event-stream'}, request=request)
    message = {'role': 'assistant', 'content': text, 'reasoning_content': reasoning}
    if reason == 'tool_calls':
        message['tool_calls'] = [call]
    return httpx.Response(200, json={'id': 'fixture', 'object': 'chat.completion', 'created': 1, 'model': 'fixture',
                          'choices': [{'index': 0, 'message': message, 'finish_reason': reason}]}, request=request)


def check_browser_download(monkeypatch, path, session_id, other_session):
    """Use the native Webapp's authenticated same-origin file ticket and byte routes."""
    from hermes_cli import web_server, web_server_file_tickets
    from hermes_cli.web_routers.files import _is_host_file
    assert _is_host_file(path, None)
    assert Path(path).stat().st_mode & 0o077 == 0
    # Same browser-serving mode as upstream file-ticket tests. The opaque browser
    # credential is scoped to this temporary profile; no live dashboard is contacted.
    monkeypatch.setattr(web_server.app.state, 'ui_surface', 'webapp', raising=False)
    monkeypatch.setattr(web_server.app.state, 'auth_required', False, raising=False)
    monkeypatch.setattr(web_server.app.state, 'bound_host', None, raising=False)
    monkeypatch.setattr(web_server, '_SESSION_TOKEN', secrets.token_urlsafe(32))
    client = TestClient(web_server.app)
    try:
        headers = {web_server._SESSION_HEADER_NAME: web_server._SESSION_TOKEN}
        query = {'path': path, 'session_id': session_id}
        mint = '/api/files/ticket'
        route = web_server_file_tickets.ROUTES['download']
        assert client.post(mint, json={'route': 'download', **query}).status_code == 401
        token = client.post(mint, json={'route': 'download', **query}, headers=headers)
        assert token.status_code == 200, token.text
        args = {**query, 'ticket': token.json()['ticket']}
        assert client.get(route, params=query).status_code == 401
        assert client.get(route, params={**args, 'session_id': other_session}).status_code == 401
        assert client.get(route, params={**args, 'path': path + 'x'}).status_code == 401
        result = client.get(route, params=args)
        assert result.status_code == 200, result.text
        assert result.content == Path(path).read_bytes()
        assert result.headers['content-type'].startswith('text/plain')
        return result.content
    finally:
        client.close()


@pytest.mark.parametrize('bridge,decision', [(False, 'approve'), ('single', 'reject'), ('batch', 'approve')])
def test_owner_websocket_hides_memory_tool_preamble_until_paired_decision(rig, monkeypatch, bridge, decision):
    from hermes_cli.plugins import _delivery_manager
    from run_agent import AIAgent
    from tui_gateway import server
    from tui_gateway.ws import handle_ws
    from hermes_state import SessionDB
    from hermes_cli.web_routers.sessions import manage_router
    from sparkie_sparks import memory_review
    from sparkie_sparks.telegram_controls import register
    from telegram import Update
    rig['client'].app.include_router(manage_router)

    def stored_history(key):
        response = rig['client'].get('/api/sessions/' + key + '/messages')
        assert response.status_code == 200, response.text
        return response.json()['messages']

    if hasattr(memory_review, 'memory_execution'):
        monkeypatch.setitem(_delivery_manager()._middleware, 'tool_execution', [memory_review.memory_execution])
    if bridge:
        from tools import tool_search
        search = tool_search.ToolSearchConfig.from_raw({'enabled': 'on', 'defer': ['memory', 'read_file']})
        monkeypatch.setattr(tool_search, 'load_config', lambda: search)
        monkeypatch.setattr(tool_search, 'load_config_readonly', lambda: search)
    send = httpx.Client.send

    def provider(client, request, **kwargs):
        if request.url.host == '127.0.0.1' and request.url.path.endswith('/chat/completions'):
            return scripted_provider(request, bridge)
        return send(client, request, **kwargs)

    monkeypatch.setattr(httpx.Client, 'send', provider)

    session_keys = {}
    def build(sid, session):
        session_keys[sid] = session['session_key']
        if session.get('agent') is None:
            session['agent'] = AIAgent(model='fixture', provider='custom', base_url='http://127.0.0.1:31234/v1',
                api_key='offline', api_mode='chat_completions', session_id=session['session_key'], session_db=db,
                enabled_toolsets=['memory', 'file', 'no_mcp'], quiet_mode=True, skip_context_files=True,
                skip_background_review=True, max_iterations=4, max_tokens=512)
            session['agent_ready'].set()

    monkeypatch.setattr(server, '_start_agent_build', build)
    app = FastAPI()
    @app.websocket('/ws')
    async def native_socket(ws: WebSocket):
        # Supply the authenticated identity a normal WS upgrade passes into native Hermes.
        await handle_ws(ws, auth_identity={'user_id': 'fixture-owner', 'provider': 'basic', 'issuer': ''})

    wire = []
    def rpc(socket, method, params, number):
        socket.send_json({'jsonrpc': '2.0', 'method': method, 'params': params, 'id': number})
    def until(socket, check):
        for _ in range(120):
            frame = socket.receive_json()
            wire.append(frame)
            if check(frame):
                return frame
        raise AssertionError('Native frame missing: ' + repr(wire[-4:]))

    with SessionDB(db_path=memory_review.default_home() / 'state.db') as db, TestClient(app) as client, client.websocket_connect('/ws') as socket:
        monkeypatch.setattr(server, '_db', db)
        rpc(socket, 'session.create', {}, 1)
        one = until(socket, lambda f: f.get('id') == 1)['result']['session_id']
        rpc(socket, 'session.create', {}, 2)
        two = until(socket, lambda f: f.get('id') == 2)['result']['session_id']
        rpc(socket, 'prompt.submit', {'session_id': one, 'text': 'Remember this and give me a drawer label.'}, 3)
        until(socket, lambda f: any(t in str(f) for t in (FALSE, 'A memory change is waiting', '"error"', 'message.complete')))
        assert FALSE not in json.dumps(wire), 'pre-tool model text reached the owner socket'
        assert any('A memory change is waiting' in str(f) for f in wire), repr(wire[-4:])
        pending_history = stored_history(session_keys[one])
        assert pending_history and TOOL_REASONING not in json.dumps(wire + pending_history)
        assert FALSE not in json.dumps(pending_history)
        row = rig['client'].get(API).json()[0]
        rpc(socket, 'prompt.submit', {'session_id': two, 'text': 'Independent question.'}, 4)
        independent = until(socket, lambda f: 'message.complete' in str(f) and 'Independent answer.' in str(f))
        assert OTHER_REASONING in str(independent)
        assert not any('message.complete' in str(f) and LABEL in str(f) for f in wire)

        async def approve():
            telegram, output = telegram_fixture()
            async with telegram:
                register(telegram, None)
                text = '/memoryreview ' + decision + ' ' + row['id'] + ' ' + row['digest']
                incoming = {'update_id': 37, 'message': {'message_id': 5, 'date': 1, 'chat': {'id': USER, 'type': 'private'},
                    'from': {'id': USER, 'is_bot': False, 'first_name': 'Owner'}, 'text': text,
                    'entities': [{'type': 'bot_command', 'offset': 0, 'length': len('/memoryreview')}]}}
                await telegram.process_update(Update.de_json(incoming, telegram.bot))
            assert any(('saved' if decision == 'approve' else 'rejected') in response['text'].lower() for response in output.messages), output.messages

        asyncio.run(approve())
        final = until(socket, lambda f: f.get('params', {}).get('session_id') == one and 'message.complete' in str(f))
        rpc(socket, 'session.resume', {'session_id': session_keys[one], 'lazy': True}, 5)
        reopened = until(socket, lambda f: f.get('id') == 5)['result']
        rpc(socket, 'session.history', {'session_id': reopened['session_id']}, 6)
        history = until(socket, lambda f: f.get('id') == 6)['result']['messages']
        stored = stored_history(session_keys[one])
        outcome = 'The owner rejected' if decision == 'reject' else 'verified it'
        for transcript in (history, stored):
            assert outcome in json.dumps(transcript)
            assert FALSE not in json.dumps(transcript)
        for draft_reasoning in (TOOL_REASONING, FINAL_REASONING):
            assert draft_reasoning not in json.dumps(wire + stored)
        if decision == 'reject':
            assert 'The owner rejected' in str(final)
            payload = final['params']['payload']
            text = payload.get('text') or payload.get('raw')
            assert 'MEDIA:' in text and 'Open the attached text file' in text
            assert 'I have saved the rejected value' not in json.dumps(wire)
            assert LABEL not in json.dumps(wire + stored)
            path = text.split('\nMEDIA:', 1)[1].strip()
            body = check_browser_download(monkeypatch, path, session_keys[one], session_keys[two])
            assert body == rejected_document()
        else:
            assert LABEL in str(final)
            assert 'MEDIA:' not in str(final)
        assert all('Unverified assistant draft' not in str(f) for f in wire if f.get('params', {}).get('session_id') == two)
        assert FALSE not in json.dumps(wire)


@pytest.mark.parametrize('decision', ['approve', 'reject'])
def test_paired_telegram_can_decide_in_the_same_busy_chat(rig, monkeypatch, decision):
    """Use Telegram's real PTB handlers, native agent turn and adapter send methods."""
    from gateway.config import PlatformConfig
    from gateway.run import GatewayRunner
    from gateway.run_turn_runner import TurnRunner
    from gateway.turn_context import TurnContext
    from hermes_cli.plugins import _delivery_manager
    from plugins.platforms.telegram.adapter import TelegramAdapter
    from run_agent import AIAgent
    from sparkie_sparks import memory_review
    from sparkie_sparks.telegram_controls import register
    from telegram import Update
    from telegram.ext import MessageHandler, filters

    if hasattr(memory_review, 'memory_execution'):
        monkeypatch.setitem(_delivery_manager()._middleware, 'tool_execution', [memory_review.memory_execution])
    send = httpx.Client.send
    def mock_provider(client, request, **kwargs):
        if request.url.host == '127.0.0.1' and request.url.path.endswith('/chat/completions'):
            return scripted_provider(request)
        return send(client, request, **kwargs)
    monkeypatch.setattr(httpx.Client, 'send', mock_provider)

    async def dispatch():
        app, output = telegram_fixture()
        attachments = []
        ordinary = output.do_request
        async def capture_document(url, method, request_data=None, **kwargs):
            if url.rsplit('/', 1)[-1] != 'sendDocument':
                return await ordinary(url, method, request_data=request_data, **kwargs)
            params = request_data.parameters
            [(filename, body, mime)] = request_data.multipart_data.values()
            if hasattr(body, 'read'):
                body = body.read()
            attachments.append((int(params['chat_id']), filename, mime, body))
            sent = {'message_id': 199, 'date': 1, 'chat': {'id': USER, 'type': 'private'},
                    'document': {'file_id': 'fixture', 'file_unique_id': 'fixture-document',
                                 'file_name': filename, 'mime_type': mime}}
            return 200, json.dumps({'ok': True, 'result': sent}).encode()
        monkeypatch.setattr(output, 'do_request', capture_document)
        adapter = TelegramAdapter(PlatformConfig(enabled=True, token='fixture', extra={'allow_from': [str(USER)]}))
        adapter._bot = app.bot
        adapter._start_typing_refresh = lambda *args, **kwargs: None
        register(app, adapter)
        app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, adapter._handle_text_message))
        loop = asyncio.get_running_loop()
        agent = AIAgent(model='fixture', provider='custom', base_url='http://127.0.0.1:31234/v1',
            api_key='offline', api_mode='chat_completions', session_id='native-telegram-memory-fixture',
            enabled_toolsets=['memory', 'no_mcp'], quiet_mode=True, skip_context_files=True,
            skip_background_review=True, platform='telegram', max_iterations=4, max_tokens=512)
        # Expose a deliberately eager draft transport. A provider preamble must never be handed
        # to this sink, even on a gateway with token streaming and interim bubbles enabled.
        def preview(text):
            if text:
                asyncio.run_coroutine_threadsafe(app.bot.send_message(USER, text), loop).result(3)
        agent.stream_delta_callback = preview
        agent.reasoning_callback = preview
        agent.interim_assistant_callback = lambda text, **kw: preview(text)
        runner = object.__new__(GatewayRunner)
        runner._consume_pending_native_image_paths = lambda key: []
        runner._delivery_adapter_for = lambda source: adapter
        runner.config = None
        async def handle(event):
            ctx = TurnContext(source=event.source, message=event.text, session_id=agent.session_id, session_key=agent.session_id,
                              reply_expected=True, _loop_for_step=loop, _run_still_current=lambda: True)
            turn = object.__new__(TurnRunner)
            turn._ctx, turn._runner = ctx, runner
            result = await asyncio.to_thread(turn._run_conversation_with_approval, agent, [], None, None, None)
            assert not result.get('last_reasoning')
            return result['final_response']
        adapter.set_message_handler(handle)
        # Remove the short text debounce; leave BasePlatformAdapter's actual busy-chat slot,
        # background task and final send in place.
        incoming_tasks = []
        def dispatch_event(event):
            incoming_tasks.append(asyncio.create_task(adapter.handle_message(event)))
        adapter._enqueue_text_event = dispatch_event
        async def incoming(text, n):
            message = {'message_id': n, 'date': 1, 'chat': {'id': USER, 'type': 'private'},
                       'from': {'id': USER, 'is_bot': False, 'first_name': 'Owner'}, 'text': text}
            if text.startswith('/'):
                message['entities'] = [{'type': 'bot_command', 'offset': 0, 'length': len('/memoryreview')}]
            await app.process_update(Update.de_json({'update_id': n, 'message': message}, app.bot))
        async def await_message(fragment):
            for _ in range(160):
                texts = [str(params.get('text', '')) for method, params in output.calls if method.startswith(('send', 'edit'))]
                assert not any(FALSE in text for text in texts), texts
                assert all(TOOL_REASONING not in text and FINAL_REASONING not in text for text in texts)
                if any(fragment in text for text in texts):
                    return texts
                await asyncio.sleep(.05)
            raise AssertionError((fragment, output.calls, [str(t.exception()) for t in incoming_tasks if t.done()]))
        async with app:
            await incoming('Remember this and give me a drawer label.', 1)
            await await_message('memory change is waiting')
            row = rig['client'].get(API).json()[0]
            await incoming('/memoryreview ' + decision + ' ' + row['id'] + ' ' + row['digest'], 2)
            if decision == 'approve':
                texts = await await_message('Key Reserve')
                assert any('verified it' in text for text in texts)
                assert not attachments
            else:
                await await_message('Open the attached text file')
                for _ in range(100):
                    if attachments:
                        break
                    await asyncio.sleep(.05)
                [(chat, name, mime, content)] = attachments
                assert chat == USER and name.endswith('unverified-assistant-draft.txt')
                assert mime == 'text/plain' and content == rejected_document()
                assert all('I have saved the rejected value' not in str(params.get('text', ''))
                           and LABEL not in str(params.get('text', '')) for _, params in output.calls)
    asyncio.run(dispatch())


def rejected_document():
    return ('Unverified assistant draft. The checked memory outcome follows.\n'
            'The owner rejected this change.\n\nI have saved the rejected value. ' + LABEL).encode()


def test_verified_save_with_a_mixed_answer_keeps_both_parts():
    from sparkie_sparks.memory_delivery import checked_reply
    agent = SimpleNamespace(_sparkie_memory_chat='web', _sparkie_memory_outcomes=[('saved', 'Read back the saved change.')])
    assert checked_reply(agent, LABEL) == 'Read back the saved change.\n\n' + LABEL


@pytest.mark.parametrize('state', ['rejected', 'held', 'timed_out', 'closed_without_retry'])
def test_unverified_draft_write_failure_keeps_checked_reply(rig, monkeypatch, state):
    from hermes_cli import staged_uploads
    from sparkie_sparks.memory_delivery import checked_reply

    def full(*args):
        raise OSError('disk full')
    monkeypatch.setattr(staged_uploads, 'publish_staged_upload', full)
    agent = SimpleNamespace(_sparkie_memory_chat='web', _sparkie_memory_outcomes=[(state, 'Checked outcome.')])
    assert checked_reply(agent, '') == 'Checked outcome.'
    assert checked_reply(agent, 'Checked outcome.') == 'Checked outcome.'
    reply = checked_reply(agent, 'I already saved it.')
    assert reply.startswith('Checked outcome.') and 'could not be attached' in reply
    assert 'I already saved it' not in reply and 'MEDIA:' not in reply
