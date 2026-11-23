"""The approved operation records side effects and reconciles observed service state."""
import importlib
from pathlib import Path
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def rig(tmp_path, monkeypatch):
    monkeypatch.syspath_prepend(str(ROOT / 'deploy'))
    switch = importlib.import_module('brain_switch')
    switch_dir = tmp_path / 'operations'
    switch_dir.mkdir()
    monkeypatch.setattr(switch, 'OPERATIONS', switch_dir)
    monkeypatch.setattr(switch, 'protected_ancestry', lambda path: None)
    monkeypatch.setattr(importlib.import_module('promote'), 'protected_ancestry', lambda path: None)
    previous = switch.Recipe(ROOT / 'models/main-model.json', tmp_path, tmp_path, 1000, b'old-unit')
    replacement = switch.Recipe(ROOT / 'models/alternate-model.json', tmp_path, tmp_path, 1000, b'new-unit')

    class FakeHost(switch.Host):
        def __init__(self):
            self.recipe = previous
            self.container = '1' * 64
            self.invocation = 'a' * 32
            self.restarts = 0
            self.starting = self.stale = False
            self.pending_start = self.lose_reply = self.rate_limited = False
            self.fail_replacement = self.crash_after_stop = False
            self.calls = []
            self.started = []

        def observe(self, old, new, *, abort_start=False):
            if self.starting and not abort_start:
                raise RuntimeError('The previous systemd request is still pending.')
            live = self.container or self.starting
            return switch.Observed(self.recipe, self.container, self.stale, self.starting,
                                   self.invocation if live else '', self.restarts if live else 0)

        def ready(self, recipe):
            assert self.container and self.recipe == recipe and not self.starting

        def stop(self):
            self.calls.append('stop')
            self.container = None
            self.starting = False
            if self.crash_after_stop:
                raise KeyboardInterrupt

        def start(self):
            assert self.container is None and not self.stale
            if self.rate_limited:
                raise switch.SystemdRefused('systemd start limit still in effect')
            self.calls.append('start')
            self.started.append(self.recipe)
            if self.recipe == replacement and self.fail_replacement:
                self.starting = self.rate_limited = True  # Startup can also consume the rate limit.
                raise switch.SystemdRefused('replacement failed to start')
            self.container = str(len(self.started) + 1) * 64
            if self.recipe == replacement and self.lose_reply:
                self.starting = self.pending_start
                raise subprocess.TimeoutExpired('systemctl', 600)

        def install(self, current, target):
            assert self.recipe == current and self.container is None
            self.calls.append('install')
            self.recipe = target
            self.stale = True

        def reload(self):
            self.calls.append('reload')
            self.stale = False

        def reset_failed(self):
            assert self.recipe == previous and self.container is None and not self.stale
            self.calls.append('reset-failed')
            self.rate_limited = False

    host = FakeHost()
    checked = []
    monkeypatch.setattr(switch.Recipe, 'verify_artifacts', lambda recipe: checked.append(recipe))

    def invoke(action, name='brain-001', approved='a' * 64):
        return switch.execute(action, name, approved, previous, replacement, host)

    return switch, switch_dir, host, previous, replacement, checked, invoke


def test_success_binds_the_approval_and_never_repeats_effects(rig):
    switch, directory, host, previous, replacement, checked, invoke = rig
    assert invoke('switch') == 'replacement-ready'
    assert invoke('switch') == 'replacement-ready'
    assert invoke('reconcile') == 'replacement-ready'
    assert checked == [previous, replacement]
    assert host.calls == ['stop', 'install', 'reload', 'start']
    assert host.started == [replacement]
    with pytest.raises(ValueError, match='exact approved plan'):
        invoke('switch', approved='b' * 64)
    journal = switch.Journal(directory / 'brain-001')
    assert journal.data['container_id'] == host.container
    assert all(row['state'] == 'observed_complete' for row in journal.data['events'])


def test_rejected_start_cancels_exact_auto_restart_before_restoration(rig):
    switch, directory, host, previous, replacement, _, invoke = rig
    host.fail_replacement = True
    assert invoke('switch') == 'previous-model-restored'
    assert host.started == [replacement, previous]
    phases = [row['phase'] for row in switch.Journal(directory / 'brain-001').data['events']]
    assert phases.count('start-replacement-brain') == 1
    assert 'stop-exact-replacement-brain' in phases
    assert phases.index('clear-replacement-start-limit') < phases.index('start-previous-brain')
    assert invoke('switch') == 'previous-model-restored'
    assert host.recipe == previous


def test_uncertain_start_is_observed_without_redispatch(rig):
    _, _, host, _, replacement, _, invoke = rig
    host.lose_reply = host.pending_start = True
    with pytest.raises(RuntimeError, match='still pending'):
        invoke('switch')
    assert invoke('switch') == 'switching'
    with pytest.raises(RuntimeError, match='prior brain operation'):
        invoke('switch', name='brain-002')
    host.starting = False
    assert invoke('reconcile') == 'replacement-ready'
    assert host.started == [replacement]
    assert host.calls == ['stop', 'install', 'reload', 'start']


def test_crash_after_stop_recovers_without_attempting_the_replacement(rig):
    _, _, host, previous, _, _, invoke = rig
    host.crash_after_stop = True
    with pytest.raises(KeyboardInterrupt):
        invoke('switch')
    host.crash_after_stop = False
    assert invoke('reconcile') == 'previous-model-restored'
    assert host.started == [previous]
    assert host.calls == ['stop', 'reset-failed', 'start']


def test_successful_switch_can_roll_back_only_the_observed_replacement(rig):
    _, _, host, previous, replacement, _, invoke = rig
    assert invoke('switch') == 'replacement-ready'
    identifier = host.container
    host.container = 'f' * 64
    with pytest.raises(RuntimeError, match='replacement changed'):
        invoke('rollback')
    assert host.calls.count('stop') == 1
    host.container = identifier
    assert invoke('rollback') == 'previous-model-restored'
    assert invoke('rollback') == 'previous-model-restored'
    assert host.started == [replacement, previous]


@pytest.mark.parametrize('missing_event', [False, True])
@pytest.mark.parametrize('before_container', [False, True])
def test_rollback_traces_systemd_restarts_to_the_recorded_invocation(rig, monkeypatch, missing_event, before_container):
    import json
    _, _, host, previous, _, _, invoke = rig
    assert invoke('switch') == 'replacement-ready'
    host.container, host.invocation, host.restarts = 'f' * 64, 'c' * 32, 2
    if before_container:
        host.container, host.starting = None, True
    start, restart = '7d4958e842da4a758f6c1cdc7b36dcc5', '5eb03494b6584870a536b337290809b3'
    events = [(restart, 'a'), (start, 'b'), (restart, 'b'), (start, 'c')]
    if missing_event:
        events[2] = (start, 'd')  # A later manual start breaks the chain.

    def read_journal(argv, **kwargs):
        assert '_PID=1' in argv and 'UNIT=sparkie-main-brain.service' in argv and '--boot=0' in argv
        assert '--lines=4' in argv and 'MESSAGE_ID=' + start in argv and 'MESSAGE_ID=' + restart in argv
        return subprocess.CompletedProcess(argv, 0, '\n'.join(
            json.dumps({'MESSAGE_ID': event, 'INVOCATION_ID': identity * 32}) for event, identity in events))

    monkeypatch.setattr(subprocess, 'run', read_journal)
    if missing_event:
        with pytest.raises(RuntimeError, match='replacement changed'):
            invoke('rollback')
        assert host.calls.count('stop') == 1
    else:
        assert invoke('rollback') == 'previous-model-restored'
        assert host.started[-1] == previous


@pytest.mark.parametrize('has_container', [False, True])
def test_historical_rollback_cannot_target_a_later_operation_using_the_same_recipe(rig, has_container):
    switch, _, host, previous, replacement, _, invoke = rig
    assert invoke('switch') == 'replacement-ready'
    assert switch.execute('switch', 'brain-002', 'b' * 64, replacement, previous, host) == 'replacement-ready'
    assert invoke('switch', name='brain-003') == 'replacement-ready'
    if not has_container:
        host.container = None
    calls = list(host.calls)
    with pytest.raises(RuntimeError, match='later or ambiguous'):
        invoke('rollback')
    assert host.calls == calls


def test_bad_replacement_preflight_has_no_live_effect(rig, monkeypatch):
    switch, directory, host, _, replacement, _, invoke = rig

    def verify(recipe):
        if recipe == replacement:
            raise ValueError('changed checkpoint')

    monkeypatch.setattr(switch.Recipe, 'verify_artifacts', verify)
    with pytest.raises(ValueError, match='changed checkpoint'):
        invoke('switch')
    assert host.calls == []
    assert not (directory / 'brain-001').exists()


def test_observation_refuses_unreviewed_unit_and_queued_jobs(rig, tmp_path, monkeypatch):
    switch, _, _, previous, replacement, _, _ = rig
    unit = tmp_path / 'sparkie-main-brain.service'
    unit.write_bytes(previous.unit)
    monkeypatch.setattr(switch, 'UNIT_PATH', unit)
    host = switch.Host()
    state = {'FragmentPath': str(unit), 'DropInPaths': '', 'NeedDaemonReload': 'no',
             'ActiveState': 'activating', 'Job': '42', 'InvocationID': 'b' * 32, 'NRestarts': '3'}
    monkeypatch.setattr(host, 'systemctl', lambda *args: '\n'.join(f'{k}={v}' for k, v in state.items()))
    monkeypatch.setattr(switch.model_unit, 'inspect_container', lambda *args, **kwargs: None)
    with pytest.raises(RuntimeError, match='unsettled'):
        host.observe(previous, replacement, abort_start=True)
    unit.write_bytes(replacement.unit)
    with pytest.raises(RuntimeError, match='unsettled'):
        host.observe(previous, replacement)
    assert host.observe(previous, replacement, abort_start=True) == switch.Observed(
        replacement, starting=True, invocation='b' * 32, restarts=3)
    state['DropInPaths'] = '/etc/systemd/system/unknown.conf'
    with pytest.raises(RuntimeError, match='loaded definition'):
        host.observe(previous, replacement, abort_start=True)
    unit.write_bytes(b'unknown unit')
    with pytest.raises(RuntimeError, match='differs'):
        host.observe(previous, replacement, abort_start=True)


def test_interrupted_restoration_is_observed_and_cannot_resend_its_pending_start(rig):
    switch, directory, host, previous, _, _, invoke = rig
    host.fail_replacement = True
    originally_start = host.start

    def lost_previous_reply():
        if host.recipe == previous:
            host.calls.append('start')
            raise subprocess.TimeoutExpired('systemctl', 600)
        originally_start()

    host.start = lost_previous_reply
    with pytest.raises(subprocess.TimeoutExpired):
        invoke('switch')
    assert invoke('switch') == 'restoring'
    with pytest.raises(RuntimeError, match='recorded previous-model start is unverified'):
        invoke('reconcile')
    assert host.calls.count('start') == 2
    journal = switch.Journal(directory / 'brain-001')
    assert journal.data['events'][-1]['phase'] == 'start-previous-brain'
    assert journal.data['events'][-1]['state'] == 'dispatching'


@pytest.mark.parametrize('pending_restart', [False, True])
def test_approved_rollback_recovers_a_ready_model_that_has_since_crashed(rig, pending_restart):
    _, _, host, previous, replacement, _, invoke = rig
    assert invoke('switch') == 'replacement-ready'
    host.container = None
    host.starting = pending_restart
    assert invoke('rollback') == 'previous-model-restored'
    assert host.started == [replacement, previous]
    assert host.calls.count('stop') == (2 if pending_restart else 1)


def test_rollback_refuses_a_manual_start_before_docker_creates_the_container(rig):
    _, _, host, _, _, _, invoke = rig
    assert invoke('switch') == 'replacement-ready'
    host.starting, host.container, host.invocation = True, None, 'f' * 32
    calls = list(host.calls)
    with pytest.raises(RuntimeError, match='replacement changed'):
        invoke('rollback')
    assert host.calls == calls


def test_interrupted_rollback_rechecks_the_exact_target_before_stopping_it(rig, monkeypatch):
    switch, directory, host, previous, _, _, invoke = rig
    assert invoke('switch') == 'replacement-ready'
    original = host.container

    def interrupted():
        raise KeyboardInterrupt

    with monkeypatch.context() as during_stop:
        during_stop.setattr(host, 'stop', interrupted)
        with pytest.raises(KeyboardInterrupt):
            invoke('rollback')
    journal = switch.Journal(directory / 'brain-001')
    assert journal.data['state'] == 'restoring'
    assert journal.data['rollback_target']['container_id'] == original
    host.container, host.invocation = 'f' * 64, 'e' * 32
    calls = list(host.calls)
    with pytest.raises(RuntimeError, match='replacement changed'):
        invoke('reconcile')
    assert host.calls == calls
    host.container = None  # Independently observed stopped. Restore the predecessor.
    assert invoke('reconcile') == 'previous-model-restored'
    assert host.started[-1] == previous


@pytest.mark.parametrize('loaded', [False, True])
def test_reset_failed_only_accepts_a_confirmed_unloaded_unit(rig, monkeypatch, loaded):
    switch, _, _, _, _, _, _ = rig
    host = switch.Host()
    calls = []

    def systemctl(*args):
        calls.append(args)
        if args[0] == 'reset-failed':
            raise switch.SystemdRefused('Could not reset')
        if loaded:
            return switch.UNIT + ' loaded inactive dead'
        return ''

    monkeypatch.setattr(host, 'systemctl', systemctl)
    if loaded:
        with pytest.raises(switch.SystemdRefused):
            host.reset_failed()
    else:
        host.reset_failed()
    assert calls == [('reset-failed', switch.UNIT),
                     ('list-units', '--all', '--no-legend', '--plain', switch.UNIT)]
