"""Verify failure accounting and exact container ownership in maintained runners."""

import json
from pathlib import Path
import subprocess
from unittest.mock import Mock

import pytest

import sandbox_cleanup


pytestmark = pytest.mark.integration


@pytest.fixture
def docker_fixture(tmp_path, monkeypatch):
    from tools import terminal_tool, terminal_tool_lifecycle
    from tools.environments.docker import DockerEnvironment

    cleanup = sandbox_cleanup.NativeSandboxCleanup(tmp_path)
    ids = ['a' * 64, 'b' * 64]
    listed = {cid: tmp_path / 'sandboxes/docker/default/workspace' for cid in ids}
    listed['c' * 64] = tmp_path.parent / 'other/sandboxes/docker/default/workspace'
    active = {f'key-{i}': Mock(spec=DockerEnvironment, _container_id=cid[:12]) for i, cid in enumerate(ids)}
    monkeypatch.setattr(terminal_tool, '_active_environments', active)
    def docker(*args):
        if args[1] == 'inspect':
            cid, = [key for key in listed if key.startswith(args[-1])]
            return cid + ' ' + json.dumps([{'Type': 'bind', 'Source': str(listed[cid])}])
        if args[-1].startswith('id='):
            cid = args[-1][3:]
            return cid if cid in listed else ''
        assert args[-1] == 'label=hermes-agent=1'
        return '\n'.join(listed)
    monkeypatch.setattr(sandbox_cleanup, 'docker', docker)
    def teardown(key, *, force_remove):
        assert force_remove
        native = active.pop(key)
        cid, = [key for key in listed if key.startswith(native._container_id)]
        del listed[cid]
    monkeypatch.setattr(terminal_tool_lifecycle, 'cleanup_vm', teardown)
    monkeypatch.setattr(DockerEnvironment, 'wait_for_all_teardowns', lambda timeout: True)
    return cleanup, ids, listed, active


def test_cleanup_uses_allocated_keys_and_records_full_ids(docker_fixture):
    cleanup, ids, listed, _ = docker_fixture
    cleanup.capture()
    result = cleanup.finish()
    assert result['verified'] and result['teardowns_finished']
    assert [row['id'] for row in result['containers']] == ids
    assert list(listed) == ['c' * 64]


def test_cleanup_reports_unregistered_owned_container(docker_fixture):
    cleanup, ids, listed, active = docker_fixture
    cleanup.capture()
    active.pop('key-0')
    result = cleanup.finish()
    assert not result['verified'] and result['remaining_ids'] == [ids[0]]
    assert set(listed) == {ids[0], 'c' * 64}


def test_case_expecting_no_sandbox_detects_unregistered_fixture_mount(docker_fixture):
    cleanup, ids, _, active = docker_fixture
    active.clear()
    result = cleanup.finish(required=False)
    assert not result['verified'] and set(result['remaining_ids']) == set(ids)


def test_cleanup_timeout_and_daemon_failure_do_not_prove_absence(docker_fixture, monkeypatch):
    from tools.environments.docker import DockerEnvironment
    cleanup, _, _, _ = docker_fixture
    cleanup.capture()
    monkeypatch.setattr(DockerEnvironment, 'wait_for_all_teardowns', lambda timeout: False)
    docker = sandbox_cleanup.docker
    def failing(*args):
        if args[1] == 'ls':
            raise subprocess.CalledProcessError(1, ['docker', *args])
        return docker(*args)
    monkeypatch.setattr(sandbox_cleanup, 'docker', failing)
    result = cleanup.finish()
    assert not result['verified'] and not result['teardowns_finished']
    assert len(result['errors']) == 2


def test_cleanup_rejects_foreign_mount_and_wrong_id(docker_fixture, monkeypatch):
    cleanup, _, listed, active = docker_fixture
    active['key-0']._container_id = 'c' * 12
    assert not cleanup.finish()['verified'] and 'c' * 64 in listed
    monkeypatch.setattr(sandbox_cleanup, 'docker', lambda *args: 'd' * 64 + ' []')
    with pytest.raises(ValueError, match='different container ID'):
        cleanup.capture()


@pytest.mark.parametrize('network', [False, True])
def test_direct_docker_config_changes_only_private_terminal_route(tmp_path, monkeypatch, network):
    from native_docker_fixture import configure_compute_docker
    from ruamel.yaml import YAML

    machine_id = Path('/etc/machine-id')
    real_read = Path.read_text
    identity = ['synthetic-unenrolled-machine']
    monkeypatch.setattr(Path, 'read_text', lambda path, *a, **kw:
                        identity[0] if path == machine_id else real_read(path, *a, **kw))
    real_is_file = Path.is_file
    monkeypatch.setattr(Path, 'is_file', lambda path: path == machine_id or real_is_file(path))
    source = Path(__file__).resolve().parents[1] / 'config/hermes.example.yaml'
    with pytest.raises(RuntimeError, match='allocated compute Spark'):
        configure_compute_docker(tmp_path, source, network=network)
    assert not (tmp_path / 'config.yaml').exists()
    identity[0] = 'UNENROLLED_COMPUTE2_MACHINE_ID'
    configure_compute_docker(tmp_path, source, network=network)
    yaml = YAML(typ='safe')
    expected = yaml.load(source)
    expected['terminal'].update(backend='docker', cwd='/workspace', docker_network=network)
    assert yaml.load(tmp_path / 'config.yaml') == expected
