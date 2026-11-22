"""Identity enforcement around the unchanged native SSH execution backend."""
import os
from pathlib import Path
import subprocess

import pytest

pytestmark = pytest.mark.integration


@pytest.fixture
def enrollment(tmp_path):
    from sparkie_sparks.sandbox_ssh import PinnedSandboxSSH
    alias = 'sparkie-workspace-' + 'a' * 32
    pubkey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixture'
    key, hosts = tmp_path / 'client-key', tmp_path / 'known-hosts'
    key.write_text('fixture key never used for a connection')
    hosts.write_text(alias + ' ' + pubkey + '\n')
    key.chmod(0o600)
    hosts.chmod(0o600)
    args = dict(host='127.0.0.1', user='sandbox', port=2222, key_path=str(key),
                known_hosts=str(hosts), host_key_alias=alias, expected_host_key=pubkey,
                probe_only=True)
    return PinnedSandboxSSH, args


def test_unknown_enrollment_and_host_root_login_fail_before_connect(enrollment, monkeypatch):
    cls, args = enrollment
    calls = []
    monkeypatch.setattr(cls, '_establish_connection', lambda self: calls.append(True))
    for changed in ({'expected_host_key': 'ssh-ed25519 AAAADifferent'}, {'user': 'root'},
                    {'host': '-oProxyCommand=bad'}, {'port': 22}):
        with pytest.raises(ValueError):
            cls(**(args | changed))
    assert not calls


def test_symlink_or_shared_identity_file_is_refused(enrollment, monkeypatch, tmp_path):
    cls, args = enrollment
    calls = []
    monkeypatch.setattr(cls, '_establish_connection', lambda self: calls.append(True))
    linked = tmp_path / 'linked-key'
    linked.symlink_to(args['key_path'])
    with pytest.raises(OSError):
        cls(**(args | {'key_path': str(linked)}))
    Path(args['known_hosts']).chmod(0o644)
    with pytest.raises(ValueError):
        cls(**args)
    assert not calls


def test_openssh_effective_config_is_strict_and_has_no_ambient_identity(enrollment, monkeypatch):
    cls, args = enrollment
    monkeypatch.setattr(cls, '_establish_connection', lambda self: None)
    env = cls(**args)
    command = env._build_ssh_command(extra_args=['-G'])
    effective = subprocess.run(command, capture_output=True, text=True, check=True).stdout
    settings = dict(line.split(' ', 1) for line in effective.splitlines() if ' ' in line)
    assert settings['stricthostkeychecking'] == 'true'
    assert settings['hostkeyalias'] == args['host_key_alias']
    assert settings['userknownhostsfile'] == args['known_hosts']
    assert settings['globalknownhostsfile'] == '/dev/null'
    assert settings['identityagent'] == 'none'
    assert settings['identitiesonly'] == 'yes'
    assert settings['forwardagent'] == 'no'
    # Native streams call the same method; scp uses the shared target flags.
    from tools.environments.streams import exec_prefix
    assert exec_prefix(env) == env._build_ssh_command()
    flags = env._target_flags('-P')
    assert 'StrictHostKeyChecking=yes' in flags
    assert 'UserKnownHostsFile=' + args['known_hosts'] in flags
    assert flags[flags.index('-i') + 1] == args['key_path']
    env.cleanup()


def test_rotating_workspace_identity_cannot_reuse_an_older_control_master(enrollment, monkeypatch):
    from tools.environments.ssh import SSHEnvironment
    cls, args = enrollment
    monkeypatch.setattr(SSHEnvironment, '_establish_connection', lambda self: None)
    args['probe_only'] = False
    monkeypatch.setattr(SSHEnvironment, '_detect_remote_home', lambda self: '/home/sandbox')
    monkeypatch.setattr(SSHEnvironment, 'init_session', lambda self: None)
    first = cls(**args, sync_files=False)
    Path(args['key_path']).write_text('a different synthetic sandbox login key')
    second = cls(**args, sync_files=False)
    assert first.control_socket != second.control_socket
    first.cleanup()
    second.cleanup()
