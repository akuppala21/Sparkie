"""Fixed host activity sources with a synthetic /proc and native-shaped D-Bus."""
import json
import os
from pathlib import Path
from types import SimpleNamespace

import pytest

from sparkie_sparks.power_worker import host_activity


def rig(tmp_path):
    proc = tmp_path / 'proc'
    proc.mkdir()
    (proc / 'self').mkdir()
    (proc / 'self/cgroup').write_text('0::/user.slice/user-1000.slice/session-999.scope\n')
    def process(pid, *, uid=1000, parent=1, group='session-100.scope', exe='/usr/bin/sleep'):
        path = proc / str(pid)
        path.mkdir(exist_ok=True)
        (path / 'status').write_text(f'Uid:\t{uid} {uid} {uid} {uid}\nState:\tS (sleeping)\nPPid:\t{parent}\n')
        (path / 'cgroup').write_text('0::/user.slice/user-1000.slice/' + group + '\n')
        (path / 'exe').symlink_to(exe)
        return path
    process(os.getpid(), group='session-999.scope')
    process(1, uid=0, parent=0)
    data = {'sessions': [['999', 1000, 'fixture', '', '/session/999']], 'inhibitors': [], 'gpu': '', 'unit': 'inactive'}
    def run(args, **kwargs):
        if args[0] == 'busctl':
            name = 'sessions' if args[-1] == 'ListSessions' else 'inhibitors'
            kind = 'a(susso)' if name == 'sessions' else 'a(ssssuu)'
            return SimpleNamespace(returncode=0, stdout=json.dumps({'type': kind, 'data': [data[name]]}))
        return SimpleNamespace(returncode=0, stdout=data['gpu'] if args[0] == 'nvidia-smi' else data['unit'])
    return proc, process, data, run


def test_only_own_probe_session_and_verified_native_baseline_can_be_ignored(tmp_path):
    proc, process, data, run = rig(tmp_path)
    process(90001, group='user@1000.service/init.scope', exe='/usr/lib/systemd/systemd')
    assert host_activity(runner=run, proc=proc) == []
    process(90002, group='user@1000.service/init.scope', exe='/usr/bin/sleep')
    assert host_activity(runner=run, proc=proc)


def test_nondumpable_native_user_manager_requires_system_unit_exact_pid(tmp_path, monkeypatch):
    proc, process, data, run = rig(tmp_path)
    path = process(90001, group='user@1000.service/init.scope', exe='/usr/lib/systemd/systemd')
    original = Path.resolve
    def denied(self, *args, **kwargs):
        if self == path / 'exe': raise PermissionError('Native non-dumpable user manager')
        return original(self, *args, **kwargs)
    monkeypatch.setattr(Path, 'resolve', denied)
    def native(args, **kwargs):
        if args == ['systemctl', 'show', '--property=MainPID', '--value', 'user@1000.service']:
            return SimpleNamespace(returncode=0, stdout=data['manager'])
        return run(args, **kwargs)
    data['manager'] = '90001\n'
    assert host_activity(runner=native, proc=proc) == []
    data['manager'] = '90002\n'
    assert host_activity(runner=native, proc=proc) is None


def test_native_pam_baseline_requires_exact_system_manager_parent_and_scope(tmp_path, monkeypatch):
    proc, process, data, run = rig(tmp_path)
    path = process(90002, parent=90001, group='user@1000.service/init.scope')
    (path / 'comm').write_text('(sd-pam)\n')
    original = Path.resolve
    def denied(self, *args, **kwargs):
        if self == path / 'exe': raise PermissionError('Native PAM helper')
        return original(self, *args, **kwargs)
    monkeypatch.setattr(Path, 'resolve', denied)
    def native(args, **kwargs):
        if args == ['systemctl', 'show', '--property=MainPID', '--value', 'user@1000.service']:
            return SimpleNamespace(returncode=0, stdout='90001\n')
        return run(args, **kwargs)
    assert host_activity(runner=native, proc=proc) == []
    (path / 'comm').write_text('owner-job\n')
    assert host_activity(runner=native, proc=proc) is None
    (path / 'comm').write_text('(sd-pam)\n')
    (path / 'status').write_text('Uid:\t1000\nState:\tS\nPPid:\t90003\n')
    assert host_activity(runner=native, proc=proc) is None


@pytest.mark.parametrize('source', ['session', 'root_session', 'detached', 'gpu', 'shutdown', 'protected_unit'])
def test_owner_work_and_inhibitors_prevent_shutdown(tmp_path, source):
    proc, process, data, run = rig(tmp_path)
    if source == 'session': data['sessions'].append(['20', 1000, 'owner', '', '/session/20'])
    if source == 'root_session': data['sessions'].append(['20', 0, 'root', '', '/session/20'])
    if source == 'detached': process(90001, parent=1)
    if source == 'gpu': data['gpu'] = '90001\n'
    if source == 'shutdown': data['inhibitors'] = [['shutdown', 'fixture', 'protected work', 'block', 1000, 90001]]
    if source == 'protected_unit': data['unit'] = 'active'
    assert host_activity(runner=run, proc=proc, protected_units=('owner-job.service',))


def test_named_safe_service_exception_does_not_allow_arbitrary_processes(tmp_path):
    proc, process, data, run = rig(tmp_path)
    process(90001, group='user@1000.service/app.slice/reviewed-idle-daemon.service')
    assert host_activity(runner=run, proc=proc, allowed_user_units=('reviewed-idle-daemon.service',)) == []
    process(90002, group='session-200.scope')
    assert host_activity(runner=run, proc=proc, allowed_user_units=('reviewed-idle-daemon.service',))


def test_unavailable_or_malformed_activity_remains_unknown(tmp_path):
    proc, process, data, run = rig(tmp_path)
    assert host_activity(runner=lambda *a, **k: SimpleNamespace(returncode=1, stdout=''), proc=proc) is None
    data['sessions'] = ['bad']
    assert host_activity(runner=run, proc=proc) is None


def test_sleep_key_handlers_and_normal_delay_helpers_do_not_claim_shutdown_work(tmp_path):
    proc, process, data, run = rig(tmp_path)
    data['inhibitors'] = [['handle-power-key', 'gdm', 'keys', 'block', 127, 20],
                          ['sleep', 'NetworkManager', 'network', 'delay', 0, 21]]
    assert host_activity(runner=run, proc=proc) == []
