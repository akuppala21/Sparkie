"""Qualify native filesystem permissions in an ordinary disposable container.

No host-root mount, privileged container, fleet command, bot or model call.
This proves the home layout across independent non-root processes; it does not
claim an installed systemd unit or host administrator action was tested.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--hermes', type=Path, required=True)
    args = parser.parse_args()
    if not Path('/.dockerenv').is_file() or os.geteuid() != 0:
        parser.error('This fixture requires the disposable container, not host-root execution.')
    from ruamel.yaml import YAML
    source, hermes = args.source.resolve(), args.hermes.resolve()
    root = Path('/var/lib/sparkie-permissions')
    root.mkdir(mode=0o755)
    home, os_home = root / 'hermes-home', root / 'os-home'
    # Match the installation's ordinary runtime UID; the sealed candidate's
    # outer bind is owner-private. The container mount remains read-only.
    uid = gid = 1000
    os_home.mkdir(mode=0o700)
    os.chown(os_home, uid, gid)
    config = YAML().load(source / 'config/hermes.example.yaml')
    config['webapp'] = {'enabled': False}
    config['platforms'] = {'telegram': {'enabled': False}}
    config_path = root / 'native-config.yaml'
    with config_path.open('w') as stream: YAML().dump(config, stream)
    sys.path.insert(0, str(source / 'deploy'))
    protected = module('protected_home', source / 'deploy/protected_home.py')
    previous_umask = os.umask(0o077)
    try:
        protected.prepare(home, uid=uid, gid=gid, configuration=config_path,
                          soul=source / 'SOUL.md', skills=source / 'skills')
    finally:
        os.umask(previous_umask)
    def unprivileged():
        os.setgroups([])
        os.setgid(gid)
        os.setuid(uid)
        os.umask(0o077)

    python = str(hermes / '.venv/bin/python')
    preview = root / 'paused-preview-snapshot'
    preview.mkdir()
    (preview / 'config.yaml').write_text('dashboard:\n  theme: rose\n  font: system-sans\nmodel:\n  provider: unreviewed-cloud\nhooks_auto_accept: true\n')
    (preview / 'dashboard-themes').mkdir()
    (preview / 'dashboard-themes/fixture.yaml').write_text('name: fixture\nlabel: Fixture\n')
    (preview / 'ui-preferences.json').write_text(json.dumps({'version': 1, 'revision': 1,
        'values': {'hermes.desktop.fixture-appearance': 'fixture-value'}}))
    restored = subprocess.run([python, '-B', str(source / 'deploy/managed_config.py'), '--home', str(home),
        '--import-preview', str(preview), '--runtime-uid', str(uid), '--runtime-gid', str(gid)],
        cwd=hermes, env={'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': str(os_home),
            'HERMES_HOME': str(home), 'PYTHONPATH': str(hermes)}, preexec_fn=unprivileged,
        capture_output=True, text=True, timeout=30)
    assert restored.returncode == 0, restored.stderr
    imported = json.loads(restored.stdout)
    assert imported == {'imported_config_keys': ['dashboard.theme', 'dashboard.font'],
        'native_themes': 1, 'native_ui_preferences': True, 'policy_changed': False}
    assert YAML().load(home / 'config.yaml')['dashboard']['theme'] == 'rose'
    assert 'unreviewed-cloud' not in (home / 'config.yaml').read_text()
    assert (home / 'dashboard-themes/fixture.yaml').read_bytes() == (preview / 'dashboard-themes/fixture.yaml').read_bytes()
    private_config = root / 'private-config'
    private_config.mkdir(mode=0o750)
    os.chown(private_config, 0, gid)
    for name, owner, group, mode in (
        ('allowed.json', 0, gid, 0o640), ('user-group.json', uid, gid, 0o640),
        ('group-write.json', 0, gid, 0o660), ('other-read.json', 0, gid, 0o644),
        ('other-group.json', 0, 0, 0o640),
    ):
        item = private_config / name
        item.write_text('{"schema":1}')
        os.chown(item, owner, group)
        item.chmod(mode)
    (private_config / 'symlink.json').symlink_to(private_config / 'allowed.json')
    packaging = module('package_plugins', source / 'tools/package_plugins.py')
    bundle = root / 'bundled-plugins'
    packaging.prepare_bundle(hermes / 'plugins', bundle, source / 'plugin')
    env = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': str(os_home), 'USER': 'ubuntu', 'LOGNAME': 'ubuntu',
           'HERMES_HOME': str(home), 'PYTHONPATH': str(source / 'src') + ':' + str(hermes),
           'HERMES_BUNDLED_PLUGINS': str(bundle), 'HERMES_ENABLE_PROJECT_PLUGINS': '0',
           'HERMES_MANAGED_DIR': str(home / 'managed'), 'HERMES_CONFIG_BACKEND': 'file',
           'HERMES_DISABLE_LAZY_INSTALLS': '1', 'PYTHONDONTWRITEBYTECODE': '1', 'OPENAI_API_KEY': 'local-unused'}
    validate_command = [python, str(source / 'deploy/managed_config.py'), '--home', str(home)]
    validated = subprocess.run(validate_command, cwd=hermes, env=env, preexec_fn=unprivileged,
        capture_output=True, text=True, timeout=30)
    assert validated.returncode == 0, validated.stderr
    policy_file = home / 'managed/config.yaml'
    policy_bytes = policy_file.read_bytes()
    policy_file.write_bytes(policy_bytes + b'\n# unreviewed policy edit\n')
    refused = subprocess.run(validate_command, cwd=hermes, env=env, preexec_fn=unprivileged,
        capture_output=True, text=True, timeout=30)
    assert refused.returncode != 0 and 'policy changed' in refused.stderr
    policy_file.write_bytes(policy_bytes)
    policy_file.rename(home / 'managed/temporarily-unavailable.yaml')
    refused_missing = subprocess.run(validate_command, cwd=hermes, env=env, preexec_fn=unprivileged,
        capture_output=True, text=True, timeout=30)
    assert refused_missing.returncode != 0
    (home / 'managed/temporarily-unavailable.yaml').rename(policy_file)
    checks = r'''
import json,os
from pathlib import Path
home=Path(os.environ['HERMES_HOME'])
for name in ('scripts','plugins','profiles','managed'):
    list((home/name).iterdir())
assert (home/'.env').read_text()==''
from sparkie_sparks.broker import private_json
config=home.parent/'private-config'
assert private_json(config/'allowed.json') == {'schema':1}
config_blocked=[]
for name in ('user-group.json','group-write.json','other-read.json','other-group.json','symlink.json'):
    try: private_json(config/name)
    except (OSError,ValueError): config_blocked.append(name)
    else: raise AssertionError('Unprotected authority file accepted: '+name)
assert len(config_blocked)==5
blocked=[]
for name in ('scripts','plugins','profiles','managed','SOUL.md','.env','shell-hooks-allowlist.json'):
    try: (home/name).rename(home/(name+'.replaced'))
    except PermissionError: blocked.append('replace:'+name)
    else: raise AssertionError('Protected entry was replaceable: '+name)
for name in ('scripts','plugins','profiles'):
    try: (home/name/'unreviewed').mkdir()
    except PermissionError: blocked.append('create:'+name)
    else: raise AssertionError('Protected execution directory was writable: '+name)
for name in ('managed/config.yaml','SOUL.md','.env','shell-hooks-allowlist.json'):
    try: (home/name).write_text('unreviewed')
    except PermissionError: blocked.append('write:'+name)
    else: raise AssertionError('Protected configuration was writable: '+name)
from hermes_cli.web_routers.dashboard_ui import _set_dashboard_key
from hermes_cli.config import load_config,save_config
_set_dashboard_key('theme','midnight')
assert load_config()['dashboard']['theme']=='midnight'
change=load_config()
change['terminal']['backend']='local'
change['model']['provider']='openai'
change['hooks_auto_accept']=True
save_config(change)
assert load_config()['terminal']['backend']=='spark_compute'
assert load_config()['model']['provider']=='custom:sparkie-local'
assert load_config()['hooks_auto_accept'] is False
from hermes_state import SessionDB
db=SessionDB()
db.create_session('sparkie-permission-check','cli',model='fixture-no-inference')
db.close()
learned=home/'skills'/'fixture-learned-skill'
learned.mkdir(exist_ok=True)
(learned/'SKILL.md').write_text('Fixture native skill state, no commands.')
assert (home/'state.db').is_file()
print(json.dumps({'blocked':blocked,'native_session_write':True,'native_skill_state_writable':True,
    'root_group_configuration_read':True,'unsafe_configuration_denied':config_blocked,
    'native_theme_persisted':True,'managed_policy_preserved':True}))
'''
    start = time.monotonic()
    log = root / 'gateway.log'
    with log.open('w') as output:
        process = subprocess.Popen([python, '-m', 'hermes_cli.main', 'gateway', 'run', '--external-supervisor'],
            cwd=hermes, env=env, preexec_fn=unprivileged, stdin=subprocess.DEVNULL,
            stdout=output, stderr=subprocess.STDOUT)
    ready = None
    try:
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            assert process.poll() is None, log.read_text()[-7000:]
            try: status = json.loads((home / 'gateway_state.json').read_text())
            except (FileNotFoundError, ValueError): status = {}
            if status.get('gateway_state') == 'running' and status.get('session_store', {}).get('status') == 'ok':
                ready = status
                break
            time.sleep(.2)
        assert ready is not None, log.read_text()[-7000:]
        child = subprocess.run([python, '-c', checks], cwd=hermes, env=env, preexec_fn=unprivileged,
                               capture_output=True, text=True, timeout=30)
        assert child.returncode == 0, child.stderr[-7000:]
        result = json.loads(child.stdout.splitlines()[-1])
        assert len(result['blocked']) == 14
        protected.verify(home, gid=gid)
    finally:
        if process.poll() is None:
            stopped = subprocess.run([python, '-m', 'gateway.systemd_stop_mark', str(process.pid)],
                cwd=hermes, env=env, preexec_fn=unprivileged, capture_output=True, timeout=10)
            assert stopped.returncode == 0
            process.send_signal(signal.SIGTERM)
        try: process.wait(timeout=40)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
            raise AssertionError('Native gateway exceeded its planned-stop budget')
    assert process.returncode == 0, log.read_text()[-7000:]
    print(json.dumps({'outcome': 'passed', 'native_gateway_ready': True, 'native_gateway_exit': process.returncode,
        'independent_worker': result, 'seconds': round(time.monotonic()-start,3),
        'snapshot_preferences_imported': imported, 'native_policy_startup_check': True,
        'administrator_umask': '0077', 'runtime_policy_and_environment_readable': True,
        'changed_or_missing_policy_refused_before_startup': True,
        'host_admin_or_systemd_install_tested': False, 'privileged_container': False}))


if __name__ == '__main__':
    main()
