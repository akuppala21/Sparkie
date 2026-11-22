"""No real shutdown commands: verify the standalone worker through injected calls."""
import subprocess
from pathlib import Path
import stat
from types import SimpleNamespace

import pytest

from sparkie_sparks.power_worker import handle

HOST = 'compute-fixture'
MACHINE = '2' * 32
REQUEST = {'mode': 'sleep', 'spark': 'spark2', 'hostname': HOST, 'machine_id': MACHINE, 'hub_machine_id': '1' * 32}


def runner(*, containers='', docker_code=0, allowed=True, shutdown_error=None,
           stop_allowed=True, stop_error=None, stop_code=0):
    calls = []
    def run(args, **kwargs):
        calls.append(args)
        if args[0] == 'docker': return SimpleNamespace(returncode=docker_code, stdout=containers)
        if args[:3] == ['sudo', '-n', '-l']:
            permission = allowed if args[-1] == 'poweroff' else stop_allowed
            return SimpleNamespace(returncode=0 if permission else 1, stdout='')
        if args == ['sudo', '-n', '/usr/bin/systemctl', 'stop', 'nvidia-persistenced']:
            if stop_error: raise stop_error
            return SimpleNamespace(returncode=stop_code, stdout='')
        assert args == ['sudo', '-n', '/usr/bin/systemctl', 'poweroff']
        if shutdown_error: raise shutdown_error
        return SimpleNamespace(returncode=0, stdout='')
    return run, calls


def invoke(request=REQUEST, **settings):
    run, calls = runner(**settings)
    return handle(request, hostname=HOST, read_text=lambda path: MACHINE, runner=run), calls


def test_only_existing_narrow_privilege_and_normal_systemd_poweroff_are_used():
    result, calls = invoke()
    assert result == {'status': 'sent', 'hostname': HOST, 'machine_id': MACHINE}
    # The private config path is fresh per read; all fixed command arguments and
    # the complete privilege sequence remain asserted.
    assert calls[0][:2] == ['docker', '--config']
    assert [calls[0][:1] + calls[0][3:], *calls[1:]] == [['docker', '--host', 'unix:///var/run/docker.sock', 'ps', '--no-trunc', '--format', '{{.ID}}'],
                     ['sudo', '-n', '-l', '/usr/bin/systemctl', 'poweroff'],
                     ['sudo', '-n', '-l', '/usr/bin/systemctl', 'stop', 'nvidia-persistenced'],
                     ['sudo', '-n', '/usr/bin/systemctl', 'stop', 'nvidia-persistenced'],
                     ['sudo', '-n', '/usr/bin/systemctl', 'poweroff']]
    assert 'succeeded' not in str(result)


@pytest.mark.parametrize('settings', [{'containers': 'a' * 64 + '\n'}, {'docker_code': 1}, {'containers': 'invalid'}])
def test_worker_rechecks_running_and_unknown_workloads_before_any_privileged_call(settings):
    result, calls = invoke(**settings)
    assert result['status'] == 'refused'
    assert len(calls) == 1 and calls[0][0] == 'docker'


def test_missing_privilege_is_refused_without_installing_or_requesting_a_password():
    result, calls = invoke(allowed=False)
    assert result['status'] == 'refused' and len(calls) == 2
    assert calls[-1][:3] == ['sudo', '-n', '-l']


@pytest.mark.parametrize('change', [{'spark': 'spark1'}, {'hub_machine_id': MACHINE}, {'machine_id': '3' * 32},
                                   {'hostname': 'wrong'}, {'mode': 'shell'}, {'command': 'reboot'}])
def test_hub_identity_or_untyped_request_is_rejected_before_any_command(change):
    result, calls = invoke({**REQUEST, **change})
    assert result['status'] == 'refused' and calls == []


def test_shutdown_timeout_is_uncertain_never_completed_or_safely_not_sent():
    result, calls = invoke(shutdown_error=subprocess.TimeoutExpired('systemctl', 8))
    assert result['status'] == 'uncertain' and len(calls) == 5


def test_both_permissions_are_checked_before_any_daemon_or_power_change():
    result, calls = invoke(stop_allowed=False)
    assert result['status'] == 'refused' and len(calls) == 3
    assert all(call[:3] == ['sudo', '-n', '-l'] for call in calls[1:])


@pytest.mark.parametrize('settings', [{'stop_code': 1}, {'stop_error': subprocess.TimeoutExpired('systemctl', 20)}])
def test_uncertain_daemon_stop_does_not_attempt_poweroff(settings):
    result, calls = invoke(**settings)
    assert result['status'] == 'uncertain' and len(calls) == 4
    assert calls[-1] == ['sudo', '-n', '/usr/bin/systemctl', 'stop', 'nvidia-persistenced']


def test_readiness_inspection_has_no_privileged_call_and_unknown_docker_stays_unknown():
    result, calls = invoke({**REQUEST, 'mode': 'inspect'}, docker_code=1)
    assert result['status'] == 'observed' and result['docker_ready'] is False
    assert result['workloads'] is None and len(calls) == 1


def test_idle_read_cannot_use_ambient_remote_docker_or_owner_proxy_configuration(tmp_path, monkeypatch):
    ambient = tmp_path / 'ambient'
    ambient.mkdir()
    (ambient / 'config.json').write_text('{"currentContext":"other-host","proxies":{"default":{"httpProxy":"synthetic-secret"}}}')
    monkeypatch.setenv('DOCKER_HOST', 'ssh://owner@other-machine')
    monkeypatch.setenv('DOCKER_CONTEXT', 'other-host')
    monkeypatch.setenv('DOCKER_CONFIG', str(ambient))
    seen = []
    def run(args, **kwargs):
        seen.append(args)
        assert args[:2] == ['docker', '--config']
        assert args[3:] == ['--host', 'unix:///var/run/docker.sock', 'ps', '--no-trunc', '--format', '{{.ID}}']
        config = Path(args[2])
        assert config != ambient and config.is_dir() and not list(config.iterdir())
        assert stat.S_IMODE(config.stat().st_mode) == 0o700
        assert not any(key.startswith('DOCKER_') for key in kwargs['env'])
        return SimpleNamespace(returncode=0, stdout='a' * 64 + '\n')
    result = handle(REQUEST, hostname=HOST, read_text=lambda path: MACHINE, runner=run)
    assert result['status'] == 'refused' and len(seen) == 1
    assert not Path(seen[0][2]).exists()
