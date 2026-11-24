"""Each recorded owner choice applies one exact, previously staged native memory change."""
import asyncio
import json
from types import SimpleNamespace as NS

import pytest

from test_native_controls import USER, rig


@pytest.fixture
def isolated_profile_host(monkeypatch):
    # Serving a named profile permanently latches the real host and freezes its
    # launch environment. Give this test its own process state and restore it on exit.
    import hermes_constants
    from agent import secret_scope
    from tui_gateway import launch_profile_policy

    monkeypatch.setattr(hermes_constants, '_PINNED_PROCESS_HERMES_HOME', None)
    monkeypatch.setattr(secret_scope, '_MULTIPLEX_ACTIVE', False)
    monkeypatch.setattr(secret_scope, '_AUTO_PINNED_HOME', None)
    monkeypatch.setattr(launch_profile_policy, '_snapshot', None)
    monkeypatch.setattr(launch_profile_policy, '_source_writes', {})


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


def test_patch_stays_held_when_native_store_keeps_both_entries(rig, monkeypatch):
    from tools import memory_tool
    client = rig['client']
    before, after = 'Fixture uses blue stock.', 'Fixture uses green stock.'
    attempt(operations=[{'action': 'add', 'content': before}])
    addition, = client.get(API).json()
    assert client.post(f"{API}/{addition['id']}/approve", json={'digest': addition['digest']}).json()['state'] == 'saved'
    attempt(operations=[{'action': 'patch', 'old_text': 'blue', 'content': 'green'}])
    correction, = client.get(API).json()
    dispatches = []

    def partial_write(payload, store):
        dispatches.append(payload['target'])
        return store.add(payload['target'], after)

    monkeypatch.setattr(memory_tool, 'apply_memory_pending', partial_write)
    url = f"{API}/{correction['id']}/approve"
    response = client.post(url, json={'digest': correction['digest']})
    assert response.status_code == 400
    held, = client.get(API).json()
    assert held['id'] == correction['id'] and held['state'] == 'held'
    assert held['observation'] == {'proposed_entry_present': True, 'prior_entry_present': True}
    assert client.post(url, json={'digest': held['digest']}).status_code == 400
    assert dispatches == ['memory']
    assert memory_tool.load_on_disk_store().memory_entries == [before, after]

    from sparkie_sparks.telegram_controls import memory_review_command
    from telegram.ext import ApplicationHandlerStop
    replies = []

    async def reply(text, **kwargs):
        replies.append(text)

    msg = NS(text='/memoryreview', reply_text=reply)
    update = NS(message=msg, effective_message=msg, edited_message=None,
                effective_user=NS(id=USER, is_bot=False), effective_chat=NS(id=USER, type='private'))
    with pytest.raises(ApplicationHandlerStop):
        asyncio.run(memory_review_command(update, None))
    assert any('The original entry is still present.' in text and held['id'] in text for text in replies)


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


def test_native_file_editor_and_upload_cannot_change_memory_or_approval_records(isolated_profile_host, rig, tmp_path, monkeypatch):
    import os
    from hermes_cli.web_routers.files import router as files_router
    from hermes_constants import get_process_hermes_home

    client = rig["client"]
    client.app.include_router(files_router)
    home = get_process_hermes_home()
    store = home / "memories" / "USER.md"
    store.parent.mkdir(parents=True, exist_ok=True)
    store.write_text("Original fact")
    proposal = attempt()
    journal = home / "pending" / "memory"
    pending = journal / (proposal["pending_id"] + ".json")
    original = pending.read_bytes()
    alias = tmp_path / "linked profile entry"
    alias.symlink_to(store)
    project = tmp_path / "project"
    project.mkdir()
    notes = project / "USER.md"

    def edit(path):
        return client.post("/api/fs/write-text", json={"path": str(path), "content": "Replacement"})

    assert edit(notes).status_code == 200 and notes.read_text() == "Replacement"
    # The native editor and uploader replace an alias path atomically. A hard link
    # outside the profile is therefore independently editable without changing the store.
    hardlink = project / "prior-copy.md"
    os.link(store, hardlink)
    assert edit(hardlink).status_code == 200 and store.read_text() == "Original fact"
    assert hardlink.read_text() == "Replacement" and not hardlink.samefile(store)
    assert client.get("/api/fs/read-text", params={"path": str(store)}).json()["text"] == "Original fact"
    monkeypatch.setenv("SPARKIE_FIXTURE_LAUNCH_ONLY", "launch-test-value")
    named = home / "profiles" / "alternate"
    named.mkdir(parents=True)
    (named / "config.yaml").write_text("{}")
    assert client.post("/api/fs/write-text?profile=alternate", json={"path": str(store), "content": "Other"}).status_code == 403
    from agent.secret_scope import UnscopedSecretError, get_secret
    from hermes_cli.web_server_profiles import _config_profile_scope
    with pytest.raises(UnscopedSecretError):
        get_secret("SPARKIE_FIXTURE_LAUNCH_ONLY")
    with _config_profile_scope("alternate"):
        assert get_secret("SPARKIE_FIXTURE_LAUNCH_ONLY") is None
    with _config_profile_scope(None):
        assert get_secret("SPARKIE_FIXTURE_LAUNCH_ONLY") == "launch-test-value"
    for target in (store, alias, pending, home / "memories" / "MEMORY.md"):
        assert edit(target).status_code == 403
    upload = {"path": str(store), "data_url": "data:text/plain;base64,QUJD", "overwrite": True}
    assert client.post("/api/files/upload", json=upload).status_code == 403
    multipart = client.post("/api/files/upload-stream", data={"path": str(pending), "overwrite": "true"},
                            files={"file": ("proposal.json", b"{}", "application/json")})
    assert multipart.status_code == 403
    for target in (store, journal, home / "pending", home):
        assert client.request("DELETE", "/api/files", json={"path": str(target), "recursive": True}).status_code == 403
    assert store.read_text() == "Original fact" and pending.read_bytes() == original


def test_named_profile_memory_remains_behind_default_owner_review(isolated_profile_host, rig, tmp_path):
    import io
    import tarfile
    from hermes_cli import profiles
    from hermes_cli.web_routers.files import router as file_routes
    from hermes_cli.web_routers.profiles import router as profile_routes
    from hermes_cli.web_server_profiles import _config_profile_scope
    from hermes_constants import get_process_hermes_home
    from sparkie_sparks.memory_review import default_home

    home = get_process_hermes_home()
    client = rig["client"]
    client.app.include_router(file_routes)
    client.app.include_router(profile_routes)
    root = home / "profiles"
    named = root / "alternate"
    other = root / "another"
    for path in (named, other):
        path.mkdir(parents=True)
        (path / "config.yaml").write_text("{}")
    assert client.post("/api/profiles/active", json={"name": "alternate"}).json()["active"] == "alternate"
    with _config_profile_scope("alternate"), pytest.raises(PermissionError, match="default profile"):
        default_home()

    stores = named / "memories"
    stores.mkdir()
    entry = stores / "USER.md"
    entry.write_text("Retained preference")
    alias = tmp_path / "alias.md"
    alias.symlink_to(entry)
    journal = named / "pending" / "memory"
    journal.mkdir(parents=True)
    held = journal / "held.decision"
    held.write_text("Recorded decision")
    for source in ("default", "alternate", "another"):
        for target in (entry, stores / "MEMORY.md", alias, held, root / "future" / "memories" / "USER.md"):
            response = client.post("/api/fs/write-text", params={"profile": source},
                                   json={"path": str(target), "content": "changed"})
            assert response.status_code == 403 and "default owner profile" in response.json()["detail"], (source, target, response.text)
    for directory in (named, root, journal):
        assert client.request("DELETE", "/api/files", json={"path": str(directory), "recursive": True}).status_code == 403
    project = named / "workspace"
    project.mkdir()
    assert client.post("/api/fs/write-text", json={"path": str(project / "USER.md"), "content": "project"}).status_code == 200
    assert client.delete("/api/profiles/alternate").status_code == 400
    assert entry.read_text() == "Retained preference" and held.read_text() == "Recorded decision"

    export_alias = named / "export-note.md"
    export_alias.symlink_to(entry)
    archive_out = str(tmp_path / "export.tar.gz")
    response = client.post("/api/profiles/alternate/export", json={
        "output": archive_out, "extra_files": {"export-note.md": "unreviewed edit"}})
    assert response.status_code == 400 and entry.read_text() == "Retained preference"
    response = client.post("/api/profiles/alternate/export", json={
        "output": archive_out, "extra_files": {"ordinary-note.md": "snapshot"}})
    assert response.status_code == 200

    archive = tmp_path / "fixture.tar.gz"
    with tarfile.open(archive, "w:gz") as tar:
        for rel, content in (("config.yaml", b"{}"), ("memories/USER.md", b"incoming preference")):
            info = tarfile.TarInfo("fixture/" + rel)
            info.size = len(content)
            tar.addfile(info, io.BytesIO(content))
    with pytest.raises(ValueError, match="default owner profile"):
        profiles.import_profile(str(archive), name="imported")
    with pytest.raises(ValueError, match="default owner profile"):
        profiles.create_profile("cloned", clone_from="alternate", clone_config=True, no_alias=True)
    assert not (root / "cloned").exists() and not (root / "imported").exists()

    empty = tmp_path / "empty.tar.gz"
    with tarfile.open(empty, "w:gz") as tar:
        data = b"{}"
        info = tarfile.TarInfo("blank/config.yaml")
        info.size = len(data)
        tar.addfile(info, io.BytesIO(data))
    imported = profiles.import_profile(str(empty), name="blank")
    assert (imported / "config.yaml").is_file()
    assert client.delete("/api/profiles/blank").status_code == 200
    renamed = profiles.rename_profile("alternate", "renamed")
    assert (renamed / "memories" / "USER.md").read_text() == "Retained preference"


@pytest.mark.parametrize('action,expected', [('approve', 'saved'), ('reject', 'rejected')])
def test_chat_receives_exact_fast_owner_decision_once(rig, action, expected):
    from sparkie_sparks.memory_review import memory_execution, owner_memory_turn
    client = rig['client']
    callbacks = []
    def review(request):
        callbacks.append(request)
        row, = client.get(API).json()
        assert row['id'] == request
        assert client.post(f'{API}/{request}/{action}', json={'digest': row['digest']}).status_code == 200

    def call():
        return json.loads(memory_execution('memory', lambda: json.dumps(attempt()),
                                           session_id='chat', turn_id='turn', tool_call_id='call'))

    outcomes = []
    with owner_memory_turn('chat', on_pending=review, on_outcome=outcomes.append):
        result = call()
        assert result['state'] == expected and result['saved'] == (action == 'approve')
        assert call() == result
    assert outcomes == [result, result]
    assert callbacks == [result['pending_id']]
    assert client.get(API).json() == []


def test_memory_wait_timeout_releases_lock_and_later_owner_can_decide(rig, monkeypatch):
    from sparkie_sparks import memory_review as review
    monkeypatch.setattr(review, 'WAIT_SECONDS', 0.02)
    with review.chat_memory_wait('one', 'turn', 'call'):
        result = attempt()
    assert result['state'] == 'timed_out' and result['saved'] is False
    row, = rig['client'].get(API).json()
    assert row['id'] == result['pending_id']
    assert rig['client'].post(f"{API}/{row['id']}/approve", json={'digest': row['digest']}).json()['state'] == 'saved'


def test_cancelled_wait_and_other_chat_stage_independently(rig):
    from sparkie_sparks import memory_review as review
    with review.owner_memory_turn('original', cancelled=lambda: True):
        other = json.loads(review.memory_execution('memory', lambda: json.dumps(attempt()),
                           session_id='other', turn_id='turn', tool_call_id='call'))
        result = json.loads(review.memory_execution('memory', lambda: json.dumps(attempt()),
                            session_id='original', turn_id='turn', tool_call_id='call'))
    assert other['staged'] and result['state'] == 'interrupted'
    assert other['pending_id'] != result['pending_id']
    assert saved() == {}


def test_two_concurrent_waits_resolve_by_id_on_paired_telegram_and_web(rig):
    from concurrent.futures import ThreadPoolExecutor
    from queue import Queue
    from sparkie_sparks import memory_review as review
    from sparkie_sparks.telegram_controls import memory_review_command
    from telegram.ext import ApplicationHandlerStop
    pending = Queue()
    client = rig['client']

    def run(session):
        with review.owner_memory_turn(session, on_pending=lambda request: pending.put((session, request))):
            return json.loads(review.memory_execution('memory', lambda: json.dumps(attempt(
                operations=[{'action': 'add', 'content': session}])), session_id=session,
                turn_id='turn', tool_call_id='same-model-call-id'))

    async def reply(*args, **kwargs):
        pass

    with ThreadPoolExecutor(max_workers=2) as pool:
        a, b = pool.submit(run, 'first'), pool.submit(run, 'second')
        ids = dict([pending.get(timeout=5), pending.get(timeout=5)])
        rows = {row['id']: row for row in client.get(API).json()}
        request = ids['second']
        msg = NS(text='/memoryreview approve '+request+' '+rows[request]['digest'], reply_text=reply)
        update = NS(message=msg, effective_message=msg, edited_message=None, effective_user=NS(id=USER,is_bot=False),
                    effective_chat=NS(id=USER,type='private'))
        with pytest.raises(ApplicationHandlerStop):
            asyncio.run(memory_review_command(update, None))
        assert b.result(5)['state'] == 'saved' and not a.done()
        request = ids['first']
        assert client.post(f'{API}/{request}/reject', json={'digest': rows[request]['digest']}).status_code == 200
        assert a.result(5)['state'] == 'rejected'
    assert saved()['MEMORY.md'] == 'second'


def test_uncertain_native_write_keeps_original_chat_held(rig, monkeypatch):
    from sparkie_sparks import memory_review as review
    from tools import memory_tool
    native = memory_tool.apply_memory_pending
    def lose_ack(*args):
        native(*args)
        raise RuntimeError('lost acknowledgement')
    monkeypatch.setattr(memory_tool, 'apply_memory_pending', lose_ack)
    client = rig['client']
    def decide(request):
        row, = client.get(API).json()
        response = client.post(f'{API}/{request}/approve', json={'digest': row['digest']})
        assert response.status_code >= 400
    with review.chat_memory_wait('original', 'turn', 'call', on_pending=decide):
        result = attempt()
    assert result['state'] == 'held' and not result['saved']
    assert saved()['MEMORY.md'] == 'Separate fixture entry'


@pytest.mark.parametrize('mutation,expected', [
    ('changed_digest', 'interrupted'), ('stale_disk', 'held'), ('new_enrollment', 'enrollment_changed'),
])
def test_chat_revalidates_identity_and_saved_postcondition(rig, mutation, expected):
    from sparkie_sparks import memory_review as review
    from sparkie_sparks.authority import OwnerBinding
    client = rig['client']
    def alter(request):
        row, = client.get(API).json()
        assert client.post(f'{API}/{request}/approve', json={'digest': row['digest']}).status_code == 200
        if mutation == 'new_enrollment':
            old = rig['binding'][0]
            rig['binding'][0] = OwnerBinding('replacement', old.web_user, old.web_provider, old.web_issuer, USER, USER)
        elif mutation == 'stale_disk':
            (review.default_home() / 'memories/MEMORY.md').write_text('Later replacement')
        else:
            path = review.default_home() / 'pending/memory' / (request + '.decision')
            record = json.loads(path.read_bytes())
            path.write_text(json.dumps(dict(record, content_hash='a'*64)))
    with review.chat_memory_wait('chat', 'turn', 'call', on_pending=alter):
        result = attempt()
    assert result['state'] == expected and not result['saved']


def test_chat_staging_lock_wait_has_deadline(rig, monkeypatch):
    from sparkie_sparks import memory_review as review
    monkeypatch.setattr(review, 'WAIT_SECONDS', 0.025)
    with review._locked(), review.chat_memory_wait('chat', 'turn', 'blocked'):
        result = attempt()
    assert result['state'] == 'timed_out' and not result['pending_id']
    assert rig['client'].get(API).json() == []


@pytest.mark.parametrize('crash_during_write', [True, False])
def test_fresh_process_recovers_staging_and_native_outcome_without_dispatch(rig, crash_during_write):
    import os
    import subprocess
    import sys
    from pathlib import Path
    from sparkie_sparks import memory_review as review
    home = review.default_home()
    probe = """
import json, os, sys
from types import SimpleNamespace
from pathlib import Path
from tools import memory_tool as mt, write_approval as wa
from sparkie_sparks import controls, memory_review as review
from sparkie_sparks.authority import Owner
from test_memory_owner_review import attempt
controls._controls = SimpleNamespace(binding=lambda: SimpleNamespace(generation='generation-1'))
mode = sys.argv[1]
home = review.default_home()
native_stage = wa.stage_write
def stage(*args, **kwargs):
    with (home / 'stage-attempts').open('a') as out:
        out.write('stage\\n')
    result = native_stage(*args, **kwargs)
    if mode == 'stage-crash':
        os._exit(61)
    raise AssertionError('Replayed native staging')
wa.stage_write = stage
if mode == 'write-crash':
    native_apply = mt.apply_memory_pending
    def apply(*args, **kwargs):
        with (home / 'write-attempts').open('a') as out:
            out.write('apply\\n')
        result = native_apply(*args, **kwargs)
        assert result['success']
        os._exit(62)
    mt.apply_memory_pending = apply
    review.decide(Owner(channel='web', generation='generation-1'), sys.argv[2], sys.argv[3], action='approve')
else:
    with review.chat_memory_wait('chat', 'turn', 'id'):
        print(json.dumps(attempt()))
"""
    env = dict(os.environ, PYTHONPATH=os.pathsep.join([str(Path(__file__).parent), *sys.path]))
    def invoke(*args, code=0):
        child = subprocess.run([sys.executable, '-c', probe, *args], capture_output=True,
                               text=True, timeout=15, env=env)
        assert child.returncode == code, child.stderr
        return json.loads(child.stdout.splitlines()[-1]) if code == 0 else None

    invoke('stage-crash', code=61)
    row, = rig['client'].get(API).json()
    replay = invoke('replay')
    assert replay['state'] == 'interrupted' and replay['pending_id'] == row['id']
    if not crash_during_write:
        assert rig['client'].post(f"{API}/{row['id']}/approve", json={'digest': row['digest']}).json()['state'] == 'saved'
        after = invoke('replay')
        assert after['state'] == 'saved' and after['observation']['proposed_entry_present']
        assert saved()['MEMORY.md'] == 'Separate fixture entry'
        assert (home / 'stage-attempts').read_text().splitlines() == ['stage']
        return
    invoke('write-crash', row['id'], row['digest'], code=62)
    held = invoke('replay')
    assert held['state'] == 'held' and not held['saved'] and held['pending_id'] == row['id']
    assert saved()['MEMORY.md'] == 'Separate fixture entry'
    current, = rig['client'].get(API).json()
    assert current['id'] == row['id'] and current['state'] == 'held'
    assert current['observation']['proposed_entry_present']
    assert rig['client'].post(f"{API}/{row['id']}/close", json={'digest': current['digest']}).json()['state'] == 'closed_without_retry'
    assert invoke('replay')['state'] == 'closed_without_retry'
    assert (home / 'stage-attempts').read_text().splitlines() == ['stage']
    assert (home / 'write-attempts').read_text().splitlines() == ['apply']


def test_wait_replay_refuses_changed_enrollment_or_arguments(rig):
    from sparkie_sparks import memory_review as review
    from sparkie_sparks.authority import OwnerBinding
    with review.chat_memory_wait('chat', 'turn', 'id', cancelled=lambda: True):
        staged = attempt()
        changed = attempt(operations=[{'action': 'add', 'content': 'something else'}])
        assert changed['state'] == 'interrupted' and changed['pending_id'] is None
        old = rig['binding'][0]
        rig['binding'][0] = OwnerBinding('new', old.web_user, old.web_provider, old.web_issuer, USER, USER)
        assert attempt()['state'] == 'enrollment_changed'
        rig['binding'][0] = old
    row, = rig['client'].get(API).json()
    assert row['id'] == staged['pending_id']


@pytest.mark.parametrize('edge,terminal', [('reject-before', 'rejected'), ('reject-after', 'rejected'),
                                           ('saved-unlink', 'saved'), ('close-unlink', 'closed_without_retry')])
def test_committed_decision_survives_cleanup_crash_and_refuses_second_owner_action(rig, edge, terminal):
    import os
    from pathlib import Path
    import subprocess
    import sys
    from sparkie_sparks import memory_review as review
    with review.chat_memory_wait('chat', 'turn', 'call', cancelled=lambda: True):
        staged = attempt()
    client = rig['client']
    row, = client.get(API).json()
    original = row['id']
    probe = """
import os, sys
from pathlib import Path
from types import SimpleNamespace
from sparkie_sparks import controls, memory_review as review
from sparkie_sparks.authority import Owner
from tools import memory_tool as mt
controls._controls = SimpleNamespace(binding=lambda: SimpleNamespace(generation='generation-1'))
edge, request, digest = sys.argv[1:]
rename, unlink = Path.rename, Path.unlink
def stop_rename(source, dest):
    if dest.suffix == '.rejected' and edge == 'reject-before':
        os._exit(63)
    result = rename(source, dest)
    if dest.suffix == '.rejected' and edge == 'reject-after':
        os._exit(63)
    return result
def stop_unlink(source, *args, **kwargs):
    if source.suffix == '.held' and edge.endswith('-unlink'):
        os._exit(63)
    return unlink(source,*args,**kwargs)
Path.rename, Path.unlink = stop_rename, stop_unlink
owner = Owner('generation-1','web')
if edge == 'close-unlink':
    mt.apply_memory_pending = lambda *args: {'success':False}
    try: review.decide(owner,request,digest,action='approve')
    except ValueError: pass
    row, = review.proposals(owner)
    review.decide(owner,request,row['digest'],action='close')
else:
    review.decide(owner,request,digest,action='reject' if edge.startswith('reject') else 'approve')
"""
    env = dict(os.environ, PYTHONPATH=os.pathsep.join([str(Path(__file__).parent), *sys.path]))
    child = subprocess.run([sys.executable,'-c',probe,edge,original,row['digest']],
                           capture_output=True,text=True,timeout=15,env=env)
    assert child.returncode == 63, child.stderr
    with review.chat_memory_wait('chat', 'turn', 'call', cancelled=lambda: True):
        replay = attempt()
    assert replay['pending_id'] == staged['pending_id'] == original
    assert replay['state'] == terminal
    for operation in ('approve','reject','close'):
        assert client.post(f'{API}/{original}/{operation}', json={'digest':row['digest']}).status_code == 400
    assert client.get(API).json() == []
    assert not any((review.default_home()/'pending/memory'/(original+suffix)).exists() for suffix in ('.held','.rejected','.json'))
    final = json.loads((review.default_home()/'pending/memory'/(original+'.decision')).read_bytes())
    assert final['state'] == terminal
    assert (saved().get('MEMORY.md') == 'Separate fixture entry') == (terminal == 'saved')


def test_recovers_preexisting_retired_rejection_without_inventing_owner_audit(rig):
    from sparkie_sparks import memory_review as review
    with review.chat_memory_wait('chat','turn','call',cancelled=lambda:True):
        request = attempt()['pending_id']
    row, = rig['client'].get(API).json()
    root = review.default_home()/'pending/memory'
    # Persist exactly the older release's just-renamed proposal. Its owner
    # channel was not yet durably recorded and cannot be reconstructed.
    (root/(request+'.json')).rename(root/(request+'.rejected'))
    with review.chat_memory_wait('chat','turn','call'):
        result = attempt()
    assert result['state'] == 'rejected' and result['pending_id'] == request
    assert rig['client'].get(API).json() == []
    assert rig['client'].post(f'{API}/{request}/approve',json={'digest':row['digest']}).status_code == 400
    assert not (root/(request+'.decision')).exists() and saved() == {}


def test_native_compaction_preserves_pending_memory_approval(rig):
    from agent.context_compressor import _summarize_tool_result

    old = saved()
    args = {'action': 'add', 'target': 'memory', 'content': 'Separate fixture entry'}
    pending = attempt()
    row, = rig['client'].get(API).json()
    assert pending['pending_id'] == row['id']
    assert pending['success'] is True and pending['staged'] is True and pending['saved'] is False
    assert saved() == old

    summary = _summarize_tool_result('memory', json.dumps(args), json.dumps(pending))
    assert 'awaiting' in summary and 'approval' in summary and 'not run' in summary, summary

    rejected = rig['client'].post(f"{API}/{row['id']}/reject", json={'digest': row['digest']}).json()
    assert rejected['state'] == 'rejected'
    assert rig['client'].get(API).json() == [] and saved() == old
    failed = attempt(operations=[{'action': 'patch', 'old_text': 'absent', 'content': 'replacement'}])
    assert failed['success'] is False and failed.get('status') != 'pending_approval'
    assert rig['client'].get(API).json() == [] and saved() == old
