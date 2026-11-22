"""Run ONLY an isolated native dashboard with stand-in Spark effects.

No SSH, root, plugs, real bot, or model access is performed here. The caller must
provide an isolated HERMES_HOME and private fixture login file.
"""
import json
import os
from pathlib import Path
import runpy
import secrets
import sys
import uuid

from sparkie_sparks.authority import OwnerBinding
from sparkie_sparks.controls import Controls
from sparkie_sparks import controls
from sparkie_sparks.operations import OperationStore

home = Path(os.environ['HERMES_HOME']).resolve()
if not home.name.startswith('dashboard-home') or not os.environ.get('SPARKIE_TEST_LOGIN'):
    raise SystemExit('Use the isolated dashboard fixture home and fixture login only.')
login = json.loads(Path(os.environ['SPARKIE_TEST_LOGIN']).read_text())
from hermes_cli.dashboard_auth.registry import register_global_provider
from plugins.dashboard_auth.basic import BasicAuthProvider, hash_password
register_global_provider(BasicAuthProvider(username=login['username'], password_hash=hash_password(login['password']),
                                           secret=secrets.token_bytes(32)))
binding = OwnerBinding('browser-fixture', login['username'], 'basic', '', 12345, 12345)
fixture = home / ('control-fixture-' + uuid.uuid4().hex)
store = OperationStore(fixture / 'operations.sqlite')

from contextlib import closing
from hermes_state import SessionDB
from tools.memory_tool import load_on_disk_store
from sparkie_sparks.memory_controls import ERASE_ACTION
from sparkie_sparks.memory_erase import apply

memory_marker = 'sparkieBrowserEraseFixture'
assert load_on_disk_store().add('user', 'Retain the surrounding note. ' + memory_marker)['success']
with closing(SessionDB(db_path=home / 'state.db')) as session_db:
    session_db.create_session('memory-browser-fixture', source='cli')
    session_db.append_message('memory-browser-fixture', role='user', content='Synthetic note ' + memory_marker)


def dispatch(operation, intent):
    if intent['action'] == ERASE_ACTION:
        return apply(home, intent['plan'])['complete'] is True
    # Explicit stand-in effect log, never fleet execution.
    with (fixture / 'effects.jsonl').open('a') as handle:
        handle.write(json.dumps({'operation': operation, 'intent': intent, 'fixture': True}) + '\n')


if os.environ.get('SPARKIE_TEST_UPDATES') == '1':
    from updates_fixture import FixtureSteward, owner_controls
    controls._controls = owner_controls(store, lambda: binding, FixtureSteward())
elif os.environ.get('SPARKIE_TEST_SERVICES') == '1':
    from services_fixture import service_controls
    controls._controls = service_controls(store, binding, home)
else:
    controls._controls = Controls(store, binding=lambda: binding, dispatch=dispatch,
                                  observe=lambda *a: 'succeeded', memory_home=home)
    if os.environ.get('SPARKIE_TEST_RECOVERY') == '1':
        recovery_reads = 0
        def recovery_observe(operation, target):
            global recovery_reads
            if target.get('container') == 'd' * 64:
                recovery_reads += 1
                return 'failed' if recovery_reads >= 3 else 'unknown'
            return 'succeeded'
        controls._controls.observe = recovery_observe
        controls._controls.result_view = lambda row: (
            'The container is running.' if row['intent'].get('container') == 'd' * 64
            and row['state'] in ('uncertain', 'failed') else None)
sys.argv = ['hermes', 'dashboard', *sys.argv[1:]]
runpy.run_module('hermes_cli.main', run_name='__main__')
