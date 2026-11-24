"""Check the real systemd parser for the protected owner environment directive."""
import json
from pathlib import Path
import subprocess

import pytest

DEPLOY = Path(__file__).resolve().parents[1] / 'deploy'


def test_environment_file_is_not_silently_ignored(monkeypatch, tmp_path):
    monkeypatch.syspath_prepend(str(DEPLOY))
    from installation import environment_file
    environment = tmp_path / 'owner.env'
    environment.write_text('SPARKIE_FIXTURE=present\n')
    unit = tmp_path / 'environment-check.service'
    unit.write_text('[Unit]\nDescription=Private environment parser check\n'
                    '[Service]\nType=oneshot\nExecStart=/bin/true\n'
                    + environment_file(environment) + '\n')
    result = subprocess.run(['/usr/bin/systemd-analyze', 'verify', str(unit)],
                            capture_output=True, text=True, timeout=20)
    assert result.returncode == 0, result.stderr
    # systemd returns success even when an invalid EnvironmentFile is ignored.
    assert not result.stderr.strip(), result.stderr


@pytest.mark.parametrize('value', [
    'relative.env', '/etc/sparkie/owner file.env', '/etc/sparkie/owner\tfile.env',
    '/etc/sparkie/owner\nfile.env', '/etc/sparkie/%u.env', '/etc/sparkie/$HOME.env',
    '/etc/sparkie/"owner".env', '/etc/sparkie/owner\\file.env',
])
def test_environment_file_rejects_ambiguous_paths(monkeypatch, value):
    monkeypatch.syspath_prepend(str(DEPLOY))
    from installation import environment_file
    with pytest.raises(ValueError):
        environment_file(value)


def test_model_cache_is_group_writable_and_runtime_state_stays_private(monkeypatch, tmp_path):
    import os
    import stat

    monkeypatch.syspath_prepend(str(DEPLOY))
    import installation

    state = tmp_path / 'state'
    cache = tmp_path / 'model-cache'
    plan = {'host_machine_id': Path('/etc/machine-id').read_text().strip(),
            'uid': os.getuid(), 'gid': os.getgid(),
            'settings': {'candidate': str(tmp_path / 'candidate'), 'home': str(tmp_path / 'home'),
                         'state_root': str(state), 'model_cache': str(cache)}}
    monkeypatch.setattr(installation, 'UNITS', ())
    monkeypatch.setattr(installation, 'read_plan', lambda *args: plan)
    monkeypatch.setattr(installation, 'verify', lambda path: {'runtime': {
        'base_python': str(tmp_path / 'python'), 'base_root': str(tmp_path / 'sealed-python')}})
    monkeypatch.setattr(installation, 'protected_ancestry', lambda path: None)
    monkeypatch.setattr(installation, 'config_files', lambda settings: ())
    # Production layout: control and operations files sit directly in state, while
    # only the relay and credentials settings name nested directories.
    relay = state / 'controller' / 'relays'
    credentials = state / 'credentials' / 'workers' / 'private'
    compute = tmp_path / 'compute.json'
    compute.write_text(json.dumps({'credentials_dir': str(credentials)}))
    controller = tmp_path / 'controller.json'
    controller.write_text(json.dumps({'operations': str(state / 'operations.sqlite3'),
                                      'service_relay': {'directory': str(relay)}, 'compute_config': str(compute)}))
    plan['settings'].update(controller_config=str(controller), control_socket=str(state / 'control.sock'),
                            fleet_snapshot=str(state / 'fleet.json'), energy_database=str(state / 'energy.sqlite3'))
    monkeypatch.setattr(installation, 'prepare_home', lambda *args, **kwargs: None)
    monkeypatch.setattr(installation.subprocess, 'run', lambda *args, **kwargs: None)
    monkeypatch.setattr(installation.os, 'geteuid', lambda: 0)
    ownership = []
    monkeypatch.setattr(installation.os, 'chown', lambda path, uid, gid: ownership.append((path, uid, gid)))

    previous_umask = os.umask(0o077)
    try:
        installation.stage(tmp_path, 'fixture-plan')
    finally:
        os.umask(previous_umask)

    assert (cache, plan['uid'], plan['gid']) in ownership
    assert stat.S_IMODE(cache.stat().st_mode) == 0o770
    assert stat.S_IMODE(state.stat().st_mode) == 0o700
    expected = {state, state / 'controller', relay, state / 'credentials', credentials.parent, credentials}
    assert {path for path in state.rglob('*')} == expected - {state}
    assert all(stat.S_IMODE(path.stat().st_mode) == 0o700 for path in expected)
    assert {entry for entry in ownership if entry[0] != cache} == {
        (path, plan['uid'], plan['gid']) for path in expected}
    assert [path for path, _, _ in ownership if path in expected][-1] == state

    # A second staging attempt must preserve the existing runtime tree.
    ownership.clear()
    marker = relay / 'existing'
    marker.write_text('preserve')
    with pytest.raises(FileExistsError, match='fresh reviewed runtime paths'):
        installation.stage(tmp_path, 'fixture-plan')
    assert marker.read_text() == 'preserve' and not ownership


def test_app_updates_require_matching_private_configuration_and_native_notice_selector(monkeypatch, tmp_path):
    monkeypatch.syspath_prepend(str(DEPLOY))
    import json
    import installation
    import upgrade
    import upgrade_installation
    cfg = tmp_path/'controller.json'
    monkeypatch.setattr(upgrade,'CONTROLLER',cfg)
    settings = dict(application_updates=True, candidate='/opt/sparkie/releases/candidate', gateway_port=32131,
                    controller_config=str(cfg),home='/var/lib/sparkie/home', inventory='/etc/sparkie/inventory.json',
                    plugs='/etc/sparkie/plugs.json',environment='/etc/sparkie/owner.env')
    notice = dict(home=settings['home'], environment=settings['environment'],
                  python='/opt/sparkie/current/hermes/.venv/bin/python', source='/opt/sparkie/current/hermes')
    cfg.write_text(json.dumps({'application_updates':True, 'notifications':notice}))
    assert cfg in installation.config_files(settings)
    assert {upgrade_installation.SOCKET, upgrade_installation.SERVICE} <= set(installation.all_units(settings))
    cfg.write_text(json.dumps({'notifications':notice}))
    with pytest.raises(ValueError,match='must agree'):
        installation.config_files(settings)
    cfg.write_text(json.dumps({'application_updates':True,'notifications':{**notice,'python':'/old/python'}}))
    with pytest.raises(ValueError,match='same reviewed'):
        installation.config_files(settings)
