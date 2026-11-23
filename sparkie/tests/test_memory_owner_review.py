"""Each recorded owner choice applies one exact, previously staged native memory change."""
import asyncio
import json
from types import SimpleNamespace as NS

import pytest

from test_native_controls import USER, rig


def attempt(target='memory', *, operations=None):
    from tools.memory_tool import load_on_disk_store, memory_tool
    if operations is None:
        operations = [{'action': 'add', 'content': 'Separate fixture entry'}]
    return json.loads(memory_tool(target=target, operations=operations, store=load_on_disk_store()))


def saved():
    from hermes_constants import get_hermes_home
    return {p.name: p.read_text() for p in (get_hermes_home() / 'memories').glob('*.md')}


API = '/api/plugins/sparkie-sparks/memory/changes'


def test_exact_web_confirmation_pins_complete_content_and_refuses_replay(rig):
    text = 'Existing header ' + 'long fact ' * 25 + 'tail.'
    old = saved()
    proposal = attempt(operations=[{'action': 'add', 'content': text}])
    assert proposal['staged'] is True and proposal['saved'] is False and saved() == old
    client = rig['client']
    row, = client.get(API).json()
    assert row['content'] == text and row['id'] == proposal['pending_id']
    url = f"{API}/{row['id']}/approve"
    assert client.post(url, json={'digest': '0'*64}).status_code == 400
    assert client.post(url+'?profile=work', json={'digest':row['digest']}).status_code == 400
    assert client.post(url, json={'digest':row['digest'], 'approved':True}).status_code == 422
    assert saved() == old
    assert client.post(url,json={'digest':row['digest']}).json()['state'] == 'saved'
    assert saved()['MEMORY.md'] == text
    assert client.post(url,json={'digest':row['digest']}).status_code == 400
    assert attempt(operations=[{'action':'patch','old_text':'tail.','content':'repaired tail.'}])['staged']
    patch, = client.get(API).json()
    assert patch['entry'] == text and patch['find'] == 'tail.' and patch['content'] == 'repaired tail.'
    assert saved()['MEMORY.md'] == text
    assert client.post(f"{API}/{patch['id']}/approve",json={'digest':patch['digest']}).json()['state']=='saved'
    assert saved()['MEMORY.md'] == text.removesuffix('tail.') + 'repaired tail.'


def test_owner_authentication_rejection_and_stale_binding(rig):
    from sparkie_sparks.authority import OwnerBinding
    client = rig['client']
    before = saved()
    attempt('user')
    row, = client.get(API).json()
    url = f"{API}/{row['id']}/reject"
    binding = rig['binding'][0]
    rig['binding'][0] = OwnerBinding('replacement',binding.web_user,binding.web_provider,
                                    binding.web_issuer,USER,USER)
    assert client.get(API).json()==[]
    assert client.post(url,json={'digest':row['digest']}).status_code==403
    rig['binding'][0]=binding
    del client.headers['Authorization']
    assert client.get(API).status_code == 401
    assert client.post(url,json={'digest':row['digest']}).status_code==401
    client.cookies.set('__Host-hermes_session_at',rig['signed'].access_token)
    assert client.post(url,json={'digest':row['digest']},headers={'Sec-Fetch-Site':'cross-site'}).status_code==403
    assert client.post(url,json={'digest':row['digest']},headers={'Sec-Fetch-Site':'same-origin'}).json()['state']=='rejected'
    assert saved()==before


def test_telegram_requires_current_private_human_and_exact_digest(rig):
    from telegram.ext import ApplicationHandlerStop
    from sparkie_sparks.telegram_controls import memory_review_command
    before=saved()
    attempt('user')
    row,=rig['client'].get(API).json()
    replies=[]
    async def sent(text, **kwargs): replies.append(text)
    def send(text, *, user=USER, chat_type='private', edited=False):
        msg=NS(text=text,reply_text=sent)
        update=NS(message=msg,effective_message=msg,edited_message=msg if edited else None,
                  effective_user=NS(id=user,is_bot=False),effective_chat=NS(id=USER,type=chat_type))
        with pytest.raises(ApplicationHandlerStop):
            asyncio.run(memory_review_command(update,None))
    key = row['id']+' '+row['digest']
    send('/memoryreview')
    assert any(row['content'] in text for text in replies) and any(key in text for text in replies)
    for options in ({'user':USER+1},{'chat_type':'group'},{'edited':True}):
        send('/memoryreview approve '+key,**options)
        assert saved()==before
    send('/memoryreview approve '+row['id']+' '+'a'*64)
    assert saved()==before
    send('/memoryreview approve '+key)
    assert saved()['USER.md']=='Separate fixture entry'
    send('/memoryreview approve '+key)
    assert 'no longer pending' in replies[-1]


def test_disabled_config_inline_callback_and_native_shortcuts_cannot_authorize(rig,monkeypatch):
    from hermes_constants import get_hermes_home
    from hermes_cli.write_approval_commands import handle_pending_subcommand
    from hermes_cli.main_agent_cmds import _cmd_memory_reset
    from agent.learning_mutations import edit_node, delete_node
    from tools import write_approval as wa
    from tools.memory_tool import load_on_disk_store
    from tools.terminal_tool import set_approval_callback
    home=get_hermes_home()
    (home/'config.yaml').write_text('memory:\n  write_approval: false\n')
    before=saved()
    set_approval_callback(lambda *a,**k:'once')
    try: p=attempt()
    finally: set_approval_callback(None)
    assert p['staged'] and not p['saved'] and saved()==before
    for args in (['approve',p['pending_id']],['apply','all'],['approval','off']):
        assert 'owner confirmation' in handle_pending_subcommand(wa.MEMORY,args,memory_store=load_on_disk_store())
    with pytest.raises(SystemExit): _cmd_memory_reset(NS(target='all',yes=True))
    assert not edit_node('memory:memory:0','changed').get('ok')
    assert not delete_node('memory:memory:0').get('ok')
    assert saved()==before
    for ops in ([{'action':'remove','old_text':'Separate'}],[{'action':'add','content':'one'},{'action':'add','content':'two'}]):
        assert not attempt(operations=ops)['success']
    assert len(rig['client'].get(API).json())==1


def test_expired_review_fails_but_later_owner_can_review_same_proposal(rig,monkeypatch):
    from hermes_constants import get_hermes_home
    c = rig['client']
    saved_before = saved()
    attempt()
    row, = c.get(API).json()
    grant = get_hermes_home()/'pending/memory'/f"{row['id']}.review"
    original = json.loads(grant.read_text())
    grant.write_text(json.dumps({**original,'expires': 0}))
    url=f"{API}/{row['id']}/approve"
    assert c.post(url,json={'digest':row['digest']}).status_code==400
    assert saved()==saved_before
    fresh,=c.get(API).json()
    assert fresh['id']==row['id'] and fresh['digest']!=row['digest']
    assert c.post(url,json={'digest':row['digest']}).status_code==400
    assert c.post(url,json={'digest':fresh['digest']}).json()['state']=='saved'


def test_crash_after_native_write_is_held_without_duplicate_dispatch(rig,monkeypatch):
    from hermes_constants import get_hermes_home
    from tools import memory_tool
    c = rig['client']
    attempt()
    p, = c.get(API).json()
    called=[]
    real=memory_tool.apply_memory_pending
    def lost(payload,store):
        called.append(payload['target'])
        real(payload,store)
        raise RuntimeError('simulated lost acknowledgement')
    monkeypatch.setattr(memory_tool,'apply_memory_pending',lost)
    url=f"{API}/{p['id']}"
    assert c.post(url+'/approve',json={'digest':p['digest']}).status_code==409
    h,=c.get(API).json()
    assert h['state']=='held' and h['id']==p['id'] and h['observation']['proposed_entry_present']
    assert c.post(url+'/approve',json={'digest':h['digest']}).status_code==400
    assert attempt()['success'] is False and called==['memory']
    assert c.post(url+'/close',json={'digest':h['digest']}).json()['state']=='closed_without_retry'
    assert c.get(API).json()==[] and called==['memory']
    ledger=json.loads((get_hermes_home()/'pending/memory'/f"{p['id']}.decision").read_text())
    assert ledger['state']=='closed_without_retry'
    legacy=get_hermes_home()/'pending/memory/abcdef12.json'
    legacy.write_text(json.dumps({'id':'abcdef12','subsystem':'memory','payload':{'action':'add','target':'user','content':'legacy'}}))
    assert c.get(API).json()==[]
    assert c.post(API+'/abcdef12/approve',json={'digest':'0'*64}).status_code==400
    assert legacy.is_file() and called==['memory']


def test_background_patch_is_reviewable_and_missing_enrollment_fails_closed(rig, monkeypatch):
    from sparkie_sparks import controls
    from tools import skill_provenance
    client = rig['client']
    attempt()
    first, = client.get(API).json()
    assert client.post(f"{API}/{first['id']}/approve", json={'digest': first['digest']}).json()['state'] == 'saved'
    before = saved()
    monkeypatch.setattr(skill_provenance, 'is_unattended_review', lambda: True)
    request = attempt(operations=[{'action': 'patch', 'old_text': 'fixture', 'new_text': 'changed'}])
    row, = client.get(API).json()
    assert request['pending_id'] == row['id'] and row['content'] == 'changed'
    assert saved() == before
    monkeypatch.setattr(controls, '_controls', None)
    assert attempt()['success'] is False
    assert saved() == before


def test_native_telegram_dispatch_consumes_owner_commands(rig):
    from telegram import Update
    from telegram.ext import MessageHandler, filters
    from test_native_controls import telegram_fixture
    from sparkie_sparks.telegram_controls import register

    async def run():
        app, wire = telegram_fixture()
        forwarded = []

        async def chat(update, context):
            forwarded.append(update.update_id)

        register(app, None)
        app.add_handler(MessageHandler(filters.ALL, chat), group=1)
        async with app:
            async def send(index, text, sender=USER):
                message = {'message_id': index, 'date': 1, 'chat': {'id': USER, 'type': 'private'},
                           'from': {'id': sender, 'is_bot': False, 'first_name': 'Fixture'}, 'text': text,
                           'entities': [{'type': 'bot_command', 'offset': 0, 'length': len('/memoryreview')}]}
                await app.process_update(Update.de_json({'update_id': index, 'message': message}, app.bot))

            attempt()
            await send(1, '/memoryreview')
            commands = wire.messages[-1]['text'].splitlines()
            assert commands[0].startswith('/memoryreview approve ')
            before = saved()
            await send(2, commands[0], USER + 1)
            assert saved() == before
            await send(3, commands[0])
            assert saved()['MEMORY.md'] == 'Separate fixture entry'
            assert forwarded == []

    asyncio.run(run())


def test_concurrent_approval_and_changed_preview(rig):
    from concurrent.futures import ThreadPoolExecutor
    from hermes_constants import get_hermes_home
    client = rig['client']
    attempt()
    row, = client.get(API).json()
    path = get_hermes_home() / 'pending/memory' / (row['id'] + '.json')
    record = json.loads(path.read_bytes())
    record['payload']['operations'][0]['content'] = 'Revised proposal'
    path.write_text(json.dumps(record))
    url = f"{API}/{row['id']}/approve"
    assert client.post(url, json={'digest': row['digest']}).status_code == 400
    fresh, = client.get(API).json()
    assert fresh['content'] == 'Revised proposal' and fresh['digest'] != row['digest']
    with ThreadPoolExecutor(max_workers=2) as workers:
        outcomes = list(workers.map(lambda _: client.post(url, json={'digest': fresh['digest']}).status_code, range(2)))
    assert sorted(outcomes) == [200, 400]
    assert saved()['MEMORY.md'] == 'Revised proposal'


def test_native_failed_verification_remains_held_and_cannot_replay(rig, monkeypatch):
    from tools import memory_tool
    client = rig['client']
    before = saved()
    attempt()
    row, = client.get(API).json()
    calls = []

    def ambiguous(payload, store):
        calls.append(payload)
        return {'success': False, 'done': 1}

    monkeypatch.setattr(memory_tool, 'apply_memory_pending', ambiguous)
    url = f"{API}/{row['id']}/approve"
    assert client.post(url, json={'digest': row['digest']}).status_code == 400
    held, = client.get(API).json()
    assert held['state'] == 'held' and held['observation']['proposed_entry_present'] is False
    assert client.post(url, json={'digest': held['digest']}).status_code == 400
    assert len(calls) == 1 and saved() == before


def test_native_web_reset_requires_separate_erasure(rig):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from hermes_cli.web_routers.ops import router
    native = FastAPI()
    native.include_router(router)
    before = saved()
    with TestClient(native) as client:
        response = client.post('/api/memory/reset', json={'target': 'all'})
    assert response.status_code == 403 and 'Erase memory' in response.json()['detail']
    assert saved() == before


def test_memory_tool_definition_matches_owner_review():
    from tools import memory_tool
    from tools.registry import registry

    definition, = registry.get_definitions({"memory"}, quiet=True)
    schema = definition["function"]
    description = schema["description"]
    assert "saved=false" in description and "owner confirms that exact change" in description
    assert "Erase memory" in description
    properties = schema["parameters"]["properties"]
    assert set(properties["target"]["enum"]) == {"memory", "user"}
    operations = properties["operations"]
    assert operations["minItems"] == operations["maxItems"] == 1
    item = operations["items"]
    assert set(item["properties"]["action"]["enum"]) == {"add", "patch"}
    assert set(item["required"]) == {"action", "content"}
    assert "original target" in item["properties"]["old_text"]["description"]
