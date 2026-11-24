"""Operator cutover order, persistent uncertainty and rollback without live effects."""
import importlib.util
from pathlib import Path
import sys

import pytest

DEPLOY = Path(__file__).parents[1] / 'deploy'
sys.path.insert(0, str(DEPLOY))
import promote
import serve_route
sys.path.remove(str(DEPLOY))


class Host:
    def __init__(self, fail=None): self.events, self.fail, self.editors = [], fail, {}
    def event(self, *event):
        self.events.append(event)
        if event[0] == self.fail: raise RuntimeError('fixture interrupted effect')
    def unit_state(self, *args, **kwargs): return {'active': 'active', 'enabled': 'enabled'}
    def stop(self, units, legacy=False): self.event('stop', tuple(units), legacy)
    def start(self, units, legacy=False): self.event('start', tuple(units), legacy)
    def old_brain(self, running): self.event('old_brain', running)
    def old_brain_state(self): return True
    def editor(self, target, action):
        state = self.editors.setdefault(target, {'ActiveState': 'active', 'UnitFileState': 'enabled'})
        if action == 'observe': return state.copy()
        if action == 'retire':
            state.update(ActiveState='inactive', UnitFileState='disabled')
        elif action == 'enable':
            state['UnitFileState'] = 'enabled'
        elif action == 'start':
            state['ActiveState'] = 'active'
        # Fail after systemd acted to simulate a lost SSH acknowledgement.
        self.event('editor', target, action)
        return state.copy()
    def archive(self, path): self.event('archive', path.name)
    def private_gateway(self): self.event('gate')
    def systemctl(self, *args, **kwargs): self.event('systemctl', args, kwargs)


class API:
    def __init__(self, old):
        self.config = {'TCP': {'8443': {'HTTPS': True}}, 'Web': {serve_route.HOST: old, 'other:443': {'keep': True}}}
        self.writes = 0
    def read(self): return self.config, 'version'
    def write(self, config, etag): self.config = config; self.writes += 1


def setup(tmp_path):
    old = {'Handlers': {'/': {'Path': '/legacy'}}}
    plan = {'settings': {'expected_route': old, 'gateway_port': 32130}}
    return plan, promote.Journal(tmp_path / 'operation-one', plan_hash='a' * 64), API(old)


def test_cutover_stops_old_poller_before_new_and_records_every_effect(tmp_path):
    plan, journal, api = setup(tmp_path)
    host = Host()
    result = promote.promote(plan, 'a'*64, journal, host=host, api=api)
    assert 'awaiting-owner' in result
    assert host.events[:3] == [('stop', promote.OLD_UNITS, True), ('archive', 'legacy-state.tar.gz'), ('old_brain', False)]
    after_editors = 3 + len(promote.LEGACY_EDITORS)
    assert host.events[3:after_editors] == [('editor', target, 'retire') for target in promote.LEGACY_EDITORS]
    assert host.events[after_editors] == ('start', promote.NEW_UNITS, False)
    assert api.writes == 1 and api.config['Web']['other:443'] == {'keep': True}
    assert all(row['state'] == 'observed_complete' for row in journal.data['events'])
    with pytest.raises(FileExistsError): promote.Journal(journal.directory, plan_hash='a'*64)


def test_uncertain_phase_is_retained_and_does_not_switch_route(tmp_path):
    plan, journal, api = setup(tmp_path)
    host = Host(fail='start')
    with pytest.raises(RuntimeError): promote.promote(plan, 'a'*64, journal, host=host, api=api)
    assert journal.data['events'][-1]['state'] == 'dispatching'
    assert api.writes == 0
    host.fail = None
    before = len(host.events)
    result = promote.rollback(plan, journal, host=host, api=api)
    assert host.events[before][0:2] == ('stop', ('hermes-gateway.service', 'sparkie-collector.timer', 'sparkie-collector.service'))
    assert ('old_brain', True) in host.events
    assert result == 'old-services-restored-owner-path-needs-verification'


def test_completed_rollback_redelivery_returns_receipt_without_restarting_services(tmp_path):
    plan, journal, api = setup(tmp_path)
    host = Host()
    promote.promote(plan, 'a'*64, journal, host=host, api=api)
    first = promote.rollback(plan, journal, host=host, api=api)
    receipt = (journal.directory/'operation.json').read_bytes()
    host.events.clear()
    writes = api.writes
    # A later routing decision belongs to the owner, even if a response was lost.
    api.config['Web'][serve_route.HOST] = {'Handlers': {'/': {'Path': '/later-owner-choice'}}}
    assert promote.rollback(plan, journal, host=host, api=api) == first
    assert not host.events and api.writes == writes
    assert (journal.directory/'operation.json').read_bytes() == receipt


def test_rollback_preserves_new_state_and_unrelated_routes(tmp_path):
    plan, journal, api = setup(tmp_path)
    host = Host()
    promote.promote(plan, 'a'*64, journal, host=host, api=api)
    new_state = tmp_path / 'new-assistant-memory'
    new_state.write_text('must remain')
    api.config['Web']['other:443'] = {'changed_by_operator': True}
    promote.rollback(plan, journal, host=host, api=api)
    assert api.config['Web'][serve_route.HOST] == plan['settings']['expected_route']
    assert api.config['Web']['other:443'] == {'changed_by_operator': True}
    assert new_state.read_text() == 'must remain'


def test_rollback_does_not_start_a_previously_stopped_model(tmp_path):
    plan, journal, api = setup(tmp_path)
    host = Host()
    host.old_brain_state = lambda: False
    promote.promote(plan, 'a'*64, journal, host=host, api=api)
    promote.rollback(plan, journal, host=host, api=api)
    assert ('old_brain', True) not in host.events
    assert host.events[0] == ('stop', ('spark-console-watchdog.timer', 'spark-console-watchdog.service', 'spark-console-api.service'), True)


def test_rollback_before_editor_retirement_never_contacts_workers(tmp_path):
    plan, journal, api = setup(tmp_path)
    host = Host(fail='archive')
    with pytest.raises(RuntimeError):
        promote.promote(plan, 'a'*64, journal, host=host, api=api)
    host.events.clear()
    host.fail = 'editor'
    assert promote.rollback(plan, journal, host=host, api=api) == promote.ROLLBACK_COMPLETE
    assert ('start', ('spark-console-api.service',), True) in host.events
    assert all(entry[0] != 'editor' for entry in host.events)


def test_uncertain_editor_restore_leaves_hub_available_and_reconciles_same_journal(tmp_path, monkeypatch):
    plan, journal, api = setup(tmp_path)
    host = Host()
    # Lose the reply to the first retirement. Later workers were never touched.
    host.fail = 'editor'
    with pytest.raises(RuntimeError):
        promote.promote(plan, 'a'*64, journal, host=host, api=api)
    target = promote.LEGACY_EDITORS[0]
    assert journal.data['events'][-1]['state'] == 'dispatching'
    # The first restore's acknowledgement is lost before rollback can verify it.
    host.events.clear()
    with pytest.raises(RuntimeError):
        promote.rollback(plan, journal, host=host, api=api)
    assert ('start', ('spark-console-api.service',), True) in host.events
    assert host.events[-1] == ('editor', target, 'enable')
    assert journal.data['state'] != promote.ROLLBACK_COMPLETE
    assert api.config['Web'][serve_route.HOST] == plan['settings']['expected_route']

    # Reopen the persisted journal. The worker applied enable before losing its
    # reply. Reconnect, observe that result, and restore only its missing start.
    host.events.clear()
    def returned(worker, action):
        assert worker == target
        host.events.append(('editor', worker, action))
        if action == 'observe':
            return {'UnitFileState': 'enabled', 'ActiveState': 'inactive'}
        return {'UnitFileState': 'enabled', 'ActiveState': 'active'}
    host.editor = returned
    monkeypatch.setattr(promote, 'protected_ancestry', lambda path: None)
    reopened = promote.reviewed_rollback(journal.directory, 'a'*64)
    assert promote.rollback(plan, reopened, host=host, api=api) == promote.ROLLBACK_COMPLETE
    assert host.events == [('editor', target, 'observe'), ('editor', target, 'start')]


def test_offline_worker_does_not_block_other_retired_editors(tmp_path):
    plan, journal, api = setup(tmp_path)
    host = Host()
    promote.promote(plan, 'a'*64, journal, host=host, api=api)
    original = host.editor
    offline = promote.LEGACY_EDITORS[-1]
    def reachable(target, action):
        if target == offline:
            raise promote.subprocess.TimeoutExpired('ssh', 5)
        return original(target, action)
    host.editor = reachable
    with pytest.raises(RuntimeError, match='Hub services restored'):
        promote.rollback(plan, journal, host=host, api=api)
    assert journal.data['state'] == promote.ROLLBACK_EDITORS_PENDING
    assert [target for target, state in host.editors.items() if state['ActiveState'] == 'inactive'] == [offline]
    host.events.clear()
    host.editor = original
    assert promote.rollback(plan, journal, host=host, api=api) == promote.ROLLBACK_COMPLETE
    assert host.events == [('editor', offline, 'enable'), ('editor', offline, 'start')]


def test_cutover_refuses_a_transient_editor_before_stopping_hub(tmp_path):
    plan, journal, api = setup(tmp_path)
    host = Host()
    host.editors[promote.LEGACY_EDITORS[2]] = {'ActiveState': 'reloading', 'UnitFileState': 'enabled'}
    with pytest.raises(RuntimeError, match='unsupported state'):
        promote.promote(plan, 'a'*64, journal, host=host, api=api)
    assert not host.events and not journal.data['events'] and api.writes == 0


def test_rollback_preserves_an_editor_someone_started_after_retirement(tmp_path):
    plan, journal, api = setup(tmp_path)
    host = Host()
    target = promote.LEGACY_EDITORS[-1]
    host.editors[target] = {'ActiveState': 'inactive', 'UnitFileState': 'disabled'}
    promote.promote(plan, 'a'*64, journal, host=host, api=api)
    host.editors[target]['ActiveState'] = 'active'
    host.events.clear()
    with pytest.raises(RuntimeError, match='outside this retirement'):
        promote.rollback(plan, journal, host=host, api=api)
    assert journal.data['state'] == promote.ROLLBACK_EDITORS_PENDING
    assert host.editors[target] == {'ActiveState': 'active', 'UnitFileState': 'disabled'}
    assert not any(event[:2] == ('editor', target) for event in host.events)


def test_editor_retirement_includes_spark2_and_records_each_machine_separately(tmp_path):
    plan, journal, api = setup(tmp_path)
    host = Host()
    promote.promote(plan, 'a' * 64, journal, host=host, api=api)
    spark2_editor = ('compute2-endpoint.invalid', 'spark-portal-editor.service')
    assert ('editor', spark2_editor, 'retire') in host.events
    phases = [row['phase'] for row in journal.data['events'] if row['phase'].startswith('retire-')]
    assert len(phases) == len(set(phases))
    for address in ('compute2-endpoint.invalid', 'compute3-endpoint.invalid', 'compute4-endpoint.invalid'):
        assert 'retire-' + address + '-spark-portal-editor.service' in phases
    promote.rollback(plan, journal, host=host, api=api)
    assert ('editor', spark2_editor, 'enable') in host.events
    assert ('editor', spark2_editor, 'start') in host.events
    recovery_phases = [row['phase'] for row in journal.data['events'] if row['phase'].startswith('restore-')]
    assert len(recovery_phases) == len(set(recovery_phases))


def test_private_gate_waits_for_listener_but_never_restarts_or_accepts_anonymous_api(monkeypatch):
    from contextlib import nullcontext
    from types import SimpleNamespace
    host = object.__new__(promote.Host)
    host.settings = {'gateway_port': 32130}
    host.unit_state = lambda name: {'active': 'active'}
    calls = []
    class Client:
        bypass = False
        def open(self, url, timeout):
            calls.append(url)
            if len(calls) == 1: raise promote.urllib.error.URLError('not listening yet')
            if url.endswith('/login'): return nullcontext(SimpleNamespace(status=200))
            if not self.bypass: raise promote.urllib.error.HTTPError(url, 401, 'Unauthorized', {}, None)
            return SimpleNamespace(close=lambda: None)
    client = Client()
    monkeypatch.setattr(promote.urllib.request, 'build_opener', lambda *args: client)
    monkeypatch.setattr(promote.time, 'sleep', lambda duration: None)
    host.private_gateway()
    assert len(calls) == 3
    client.bypass = True
    with pytest.raises(RuntimeError, match='did not require sign-in'): host.private_gateway()


@pytest.mark.parametrize('action,observed', [('enable', 'ActiveState=inactive\nUnitFileState=disabled\n'),
                                           ('start', 'ActiveState=inactive\nUnitFileState=enabled\n')])
def test_old_editor_restore_requires_observed_state(monkeypatch, action, observed):
    from types import SimpleNamespace
    host = object.__new__(promote.Host)
    host.user = SimpleNamespace(pw_name='owner', pw_dir='/home/owner')
    replies = iter([SimpleNamespace(returncode=0, stdout=''), SimpleNamespace(returncode=0, stdout=observed)])
    monkeypatch.setattr(promote.subprocess, 'run', lambda *args, **kwargs: next(replies))
    with pytest.raises(RuntimeError, match='restoration was not verified'):
        host.editor(promote.LEGACY_EDITORS[0], action)
