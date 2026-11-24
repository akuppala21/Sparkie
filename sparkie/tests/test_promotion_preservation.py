"""The temporary native UI and accumulated energy survive full promotion."""
from pathlib import Path
from types import SimpleNamespace
from contextlib import closing
import json
import os
import sqlite3
import tarfile

import pytest

from test_promote import API, DEPLOY, Host, setup, promote
from installation import config_files, mutable_paths


class PreservingHost(Host):
    def preview_state(self): return True
    def preview_running(self, running): self.event('preview', running)
    def preserve_preview_preferences(self, archive):
        self.preview_running(False)
        self.event('preferences', archive.name)
    def import_energy(self):
        self.event('energy')
        return {'monthly_totals': 4, 'source_sha256': 'e' * 64}


def prepare(tmp_path):
    plan, journal, api = setup(tmp_path)
    plan['settings'].update(legacy_state='/legacy/state', preview_dashboard={'fixture': True})
    return plan, journal, api


def test_preferences_and_monthly_totals_are_preserved_before_native_services(tmp_path):
    plan, journal, api = prepare(tmp_path)
    host = PreservingHost()
    promote.promote(plan, 'a'*64, journal, host=host, api=api)
    names = [row[0] for row in host.events]
    assert names.index('archive') < names.index('energy') < names.index('old_brain') < names.index('start')
    assert names.index('start') < names.index('preview') < names.index('preferences') < names.index('gate')
    assert host.events[names.index('start')] == ('start', promote.NEW_UNITS[:2], False)
    assert ('start', (promote.NEW_UNITS[2],), False) in host.events[names.index('preferences'):names.index('gate')]
    assert host.events[names.index('preview')] == ('preview', False)
    assert journal.data['electricity_history']['monthly_totals'] == 4
    promote.rollback(plan, journal, host=host, api=api)
    assert ('preview', True) in host.events
    assert promote.ingress_routes(plan['settings'], api).current(promote.DASHBOARD) == plan['settings']['expected_route']


def test_history_failure_blocks_model_switch_and_public_route(tmp_path):
    plan, journal, api = prepare(tmp_path)
    host = PreservingHost(fail='energy')
    with pytest.raises(RuntimeError, match='fixture interrupted'):
        promote.promote(plan, 'a'*64, journal, host=host, api=api)
    assert not any(event[0] in ('old_brain', 'start') for event in host.events)
    assert api.writes == 0
    assert journal.data['events'][-1]['phase'] == 'preserve-monthly-electricity'
    assert journal.data['events'][-1]['state'] == 'dispatching'


def test_unexpected_preview_identity_is_refused_without_control(monkeypatch):
    host = object.__new__(promote.Host)
    host.settings = {'preview_dashboard': {'container_id': 'a'*64, 'image_id': 'sha256:'+'b'*64}}
    monkeypatch.setattr(promote, 'inspect_container', lambda *args: {
        'Id': 'a'*64, 'Image': 'sha256:'+'c'*64,
        'Config': {'Labels': {'sparkie.role': 'native-dashboard'}}, 'State': {'Running': True}})
    monkeypatch.setattr(promote, 'docker', lambda *args, **kwargs: pytest.fail('A different container must not be controlled'))
    with pytest.raises(RuntimeError, match='identity changed'): host.preview_running(False)


def test_failed_preference_copy_restarts_preview_and_keeps_archive(tmp_path):
    source = tmp_path/'preview'; source.mkdir(); (source/'config.yaml').write_text('dashboard:\n  theme: dark\n')
    host = object.__new__(promote.Host)
    host.settings = {'preview_dashboard': {'home': str(source)}, 'home': str(tmp_path/'final'),
                     'candidate': str(tmp_path/'candidate')}
    host.plan = {'uid': 1000, 'gid': 1000}
    host.preview_state = lambda: True
    controls = []
    host.preview_running = controls.append
    def runtime(command, **options):
        if command[0] == '/usr/bin/tar':
            with tarfile.open(fileobj=options['stdout'], mode='w:gz') as archive:
                archive.add(source, arcname='native-ui-state')
            return SimpleNamespace(returncode=0)
        assert '--import-preview' in command
        return SimpleNamespace(returncode=1)

    host._runtime = runtime
    archive = tmp_path/'native-ui-state.tar.gz'
    with pytest.raises(RuntimeError, match='could not import'):
        host.preserve_preview_preferences(archive)
    assert controls == [False, True]
    assert archive.is_file() and (archive.stat().st_mode & 0o777) == 0o600
    assert (source/'config.yaml').read_text() == 'dashboard:\n  theme: dark\n'


class InheritedEnergyHost(PreservingHost):
    prior_writer = {'database': {'readings': 124},
                    'units': {promote.PREVIEW_TIMER: {'active': 'active', 'enabled': 'disabled'},
                              promote.PREVIEW_COLLECTOR: {'active': 'activating', 'enabled': 'static'}}}

    def preview_energy_state(self):
        self.event('read-preview-energy')
        return self.prior_writer

    def pause_preview_energy(self): self.event('pause-preview-energy')
    def disable_native_collector(self): self.event('disable-native-collector')
    def restore_preview_energy(self, saved): self.event('restore-preview-energy', saved)

    def archive_preview_energy(self, archive, *, expected):
        assert expected == self.prior_writer['database']
        self.event('archive-preview-energy', archive.name)
        return {'readings': 125, 'monthly_totals': 4}


def inherited_plan(tmp_path):
    plan, journal, api = prepare(tmp_path)
    settings = plan['settings']
    settings.update(energy_database=str(tmp_path/'retained'/'electricity.sqlite3'), state_root=str(tmp_path/'fresh'))
    settings['preview_dashboard']['energy_database'] = settings['energy_database']
    return plan, journal, api


def test_single_inherited_database_and_latest_preferences_survive_promotion_and_rollback(tmp_path):
    plan, journal, api = inherited_plan(tmp_path)
    host = InheritedEnergyHost()
    promote.promote(plan, 'a'*64, journal, host=host, api=api)
    events = host.events
    assert ('energy',) not in events  # Its monthly totals already live in this database.
    assert events.index(('read-preview-energy',)) < events.index(('stop', promote.OLD_UNITS, True))
    assert events.index(('start', promote.NEW_UNITS[:2], False)) < events.index(('pause-preview-energy',))
    assert events.index(('pause-preview-energy',)) < events.index(('archive-preview-energy', 'preview-electricity.sqlite3'))
    assert events.index(('archive-preview-energy', 'preview-electricity.sqlite3')) < events.index(('preview', False))
    assert events.index(('preferences', 'native-ui-state.tar.gz')) < events.index(('start', (promote.NEW_UNITS[2],), False))
    assert events.index(('gate',)) < events.index(('start', (promote.NEW_UNITS[3],), False))
    assert journal.data['electricity_history']['readings'] == 125
    assert journal.data['electricity_history']['monthly_totals'] == 4
    start_rollback = len(events)
    promote.rollback(plan, journal, host=host, api=api)
    assert events[start_rollback] == ('stop', ('hermes-gateway.service', 'sparkie-collector.timer', 'sparkie-collector.service'), False)
    assert events[start_rollback+1:start_rollback+3] == [
        ('disable-native-collector',), ('restore-preview-energy', host.prior_writer)]
    assert ('preview', True) in events[start_rollback:]
    assert ('energy',) not in events[start_rollback:]


@pytest.mark.parametrize('failed_phase', ['preferences', 'gate'])
def test_failed_final_swap_restores_preview_and_writer_without_rerouting(tmp_path, failed_phase):
    plan, journal, api = inherited_plan(tmp_path)
    host = InheritedEnergyHost(fail=failed_phase)
    with pytest.raises(RuntimeError, match='fixture interrupted'):
        promote.promote(plan, 'a'*64, journal, host=host, api=api)
    assert host.events[-2:] == [('preview', True), ('restore-preview-energy', host.prior_writer)]
    if failed_phase == 'gate':
        assert host.events[-3] == ('stop', ('hermes-gateway.service',), False)
    assert ('start', (promote.NEW_UNITS[3],), False) not in host.events
    assert api.writes == 0


def test_install_only_excludes_the_exact_inherited_database_from_fresh_state(tmp_path):
    plan, _, _ = inherited_plan(tmp_path)
    settings = plan['settings']
    state = Path(settings['state_root'])
    controller = tmp_path/'controller.json'
    controller.write_text(json.dumps({'operations': str(state/'controller'/'operations.sqlite3')}))
    settings.update(controller_config=str(controller), fleet_snapshot=str(state/'view'/'fleet.json'),
                    control_socket=str(state/'controller'/'broker.sock'))
    assert mutable_paths(settings) == [state, state/'controller', state/'view']
    assert not Path(settings['energy_database']).parent.exists()
    settings['preview_dashboard']['energy_database'] += '.other'
    with pytest.raises(ValueError, match='exactly match'):
        mutable_paths(settings)
    del settings['preview_dashboard']['energy_database']
    with pytest.raises(ValueError, match='private state root'):
        mutable_paths(settings)


def test_inherited_database_rejects_systemd_environment_file_override(tmp_path):
    plan, _, _ = inherited_plan(tmp_path)
    settings = plan['settings']
    env, controller = tmp_path/'private.env', tmp_path/'controller.json'
    controller.write_text('{}')
    settings.update(controller_config=str(controller), environment=str(env),
                    inventory=str(tmp_path/'inventory.json'), plugs=str(tmp_path/'plugs.json'))
    env.write_text('OWNER_SUBJECT=private-value\n')
    assert env in config_files(settings)
    env.write_text('  SPARKIE_ENERGY_DATABASE = "/tmp/unused.sqlite3"\n')
    with pytest.raises(ValueError, match='would override the reviewed electricity path'):
        config_files(settings)


@pytest.mark.parametrize('include_stopped_preview', [False, True])
def test_preview_route_refuses_absent_or_stopped_source(tmp_path, include_stopped_preview):
    plan, journal, _ = prepare(tmp_path)
    route = promote.replacement(promote.PREVIEW_ROUTE_PORT)
    route['Handlers']['/console/'] = {'Path': '/legacy-console'}
    plan['settings']['expected_route'] = route
    plan['settings']['gateway_port'] = 32129
    host = PreservingHost()
    if include_stopped_preview:
        host.preview_state = lambda: False
    else:
        del plan['settings']['preview_dashboard']
    api = API(route)
    with pytest.raises(RuntimeError, match='must be included|preview is stopped'):
        promote.promote(plan, 'a'*64, journal, host=host, api=api)
    assert host.events == [] and api.writes == 0


def test_gateway_cannot_take_the_published_preview_port_before_owner_gate(tmp_path):
    plan, journal, _ = prepare(tmp_path)
    route = promote.replacement(promote.PREVIEW_ROUTE_PORT)
    route['Handlers']['/console/'] = {'Path': '/legacy-console'}
    plan['settings'].update(expected_route=route, gateway_port=promote.PREVIEW_ROUTE_PORT)
    host, api = PreservingHost(), API(route)
    with pytest.raises(ValueError, match='different port'):
        promote.promote(plan, 'a'*64, journal, host=host, api=api)
    assert host.events == [] and api.writes == 0


def test_preview_identity_binds_the_ordinary_home_and_readonly_database(tmp_path, monkeypatch):
    plan, _, _ = inherited_plan(tmp_path)
    plan.update(uid=1000, gid=1000)
    preview = plan['settings']['preview_dashboard']
    preview.update(container_id='a'*64, image_id='sha256:'+'b'*64, home=str(tmp_path/'preview-home'))
    host = object.__new__(promote.Host)
    host.plan, host.settings, host.user = plan, plan['settings'], SimpleNamespace(pw_dir='/home/owner')
    environment = '/data/observations/electricity.sqlite3'
    mounts = [
        {'Type': 'bind', 'Source': preview['home'], 'Destination': '/home/owner/.hermes', 'RW': True},
        {'Type': 'bind', 'Source': str(Path(preview['energy_database']).parent), 'Destination': '/data/observations', 'RW': False},
    ]
    row = {'Id': preview['container_id'], 'Image': preview['image_id'], 'Mounts': mounts, 'State': {'Running': True},
           'Config': {'Labels': {'sparkie.role': 'native-dashboard'}, 'User': '1000:1000',
                      'Env': ['HERMES_HOME=/home/owner/.hermes', 'SPARKIE_ENERGY_DATABASE=' + environment]}}
    monkeypatch.setattr(promote, 'inspect_container', lambda *args: row)
    assert host.preview_state()
    monkeypatch.setattr(promote, 'docker', lambda *args, **kwargs: pytest.fail('A different mount must not be controlled'))
    inherited = preview.pop('energy_database')
    with pytest.raises(RuntimeError, match='requires its inherited'):
        host.preview_running(False)
    preview['energy_database'] = inherited
    mounts[1]['RW'] = True
    with pytest.raises(RuntimeError, match='mount changed'):
        host.preview_running(False)
    mounts[1]['RW'] = False
    row['Config']['Env'][-1] = 'SPARKIE_ENERGY_DATABASE=' + environment + '.other'
    with pytest.raises(RuntimeError, match='mount changed'):
        host.preview_running(False)


def test_writer_pause_requires_exact_installed_pair_then_joins_oneshot(tmp_path):
    plan, _, _ = inherited_plan(tmp_path)
    host = object.__new__(promote.Host)
    host.settings = plan['settings']
    collector_database = plan['settings']['energy_database'] + '.other'
    calls = []

    def systemctl(action, unit, *options, legacy):
        assert legacy
        if action == 'show':
            if unit == promote.PREVIEW_TIMER:
                return SimpleNamespace(stdout=promote.PREVIEW_COLLECTOR + '\n')
            return SimpleNamespace(stdout='{ path=/usr/bin/python3 ; argv[]=/usr/bin/python3'
                                   ' -m sparkie_sparks.collector --energy-database ' + collector_database
                                   + ' ; ignore_errors=no ; }')
        calls.append((action, unit))

    host.systemctl = systemctl
    host.stop = lambda units, *, legacy: calls.append(('stop', units))
    host.unit_state = lambda unit, *, legacy: {'active': 'inactive', 'enabled': 'disabled'}
    with pytest.raises(RuntimeError, match='do not match'):
        host.pause_preview_energy()
    assert calls == []
    collector_database = plan['settings']['energy_database']
    host.pause_preview_energy()
    assert calls == [('stop', (promote.PREVIEW_TIMER,)), ('disable', promote.PREVIEW_TIMER),
                     ('stop', (promote.PREVIEW_COLLECTOR,))]


@pytest.mark.parametrize('state', [{'active': 'active', 'enabled': 'disabled'},
                                  {'active': 'inactive', 'enabled': 'enabled'}])
def test_timer_restore_preserves_running_and_boot_state_independently(state):
    host = object.__new__(promote.Host)
    host._verify_preview_writer = lambda: None
    current = {'active': 'inactive', 'enabled': 'disabled'}
    controls = []
    host.unit_state = lambda name, *, legacy: current.copy()

    def activate(units, *, legacy):
        controls.append(('start', units, legacy))
        current['active'] = 'active'

    def configure(action, unit, *, legacy):
        controls.append((action, unit, legacy))
        current['enabled'] = 'enabled'

    host.start = activate
    host.systemctl = configure
    host.restore_preview_energy({'units': {promote.PREVIEW_TIMER: state,
                                          promote.PREVIEW_COLLECTOR: {'active': 'activating'}}})
    assert current == state
    expected = (('start', (promote.PREVIEW_TIMER,), True) if state['active'] == 'active'
                else ('enable', promote.PREVIEW_TIMER, True))
    assert controls == [expected]


def test_archive_is_a_snapshot_and_later_readings_stay_in_canonical_database(tmp_path, monkeypatch):
    monkeypatch.syspath_prepend(str(DEPLOY))
    from preview_energy import inspect
    from sparkie_sparks.energy import SCHEMA
    from sparkie_sparks.energy_history import TABLE

    energy = tmp_path/'electricity.sqlite3'
    with closing(sqlite3.connect(energy)) as db, db:
        db.executescript(SCHEMA)
        db.execute(TABLE)
        db.execute("INSERT INTO readings VALUES ('spark1', 1, 'meter', 8, '2026-11', 'counter')")
        db.execute("INSERT INTO monthly_history VALUES ('spark1', '2026-11', 13, 60, 1, 61, 'fixture')")
    energy.chmod(0o600)
    identity = os.geteuid(), os.getegid()
    archive = tmp_path/'archive.sqlite3'
    with archive.open('wb') as stream:
        summary = inspect(energy, identity=identity, archive=stream)
    assert (summary['readings'], summary['monthly_totals'], summary['imported_kwh']) == (1, 1, 13)
    with closing(sqlite3.connect(energy)) as db, db:
        db.execute("INSERT INTO readings VALUES ('spark1', 2, 'meter', 9, '2026-11', 'counter')")
    with closing(sqlite3.connect(archive)) as copy:
        assert copy.execute('SELECT count(*) FROM readings').fetchone() == (1,)
    assert inspect(energy, identity=identity)['readings'] == 2
    symlink = tmp_path/'link.sqlite3'
    symlink.symlink_to(energy)
    with pytest.raises(ValueError, match='symlinks'):
        inspect(symlink, identity=identity)
    energy.chmod(0o644)
    with pytest.raises(ValueError, match='private runtime-owned'):
        inspect(energy, identity=identity)


def test_archive_refuses_a_structurally_valid_database_that_lost_samples(tmp_path):
    host = object.__new__(promote.Host)
    host.unit_state = lambda unit, *, legacy: {'active': 'inactive', 'enabled': 'disabled'}
    expected = {'database_identity': [42, 7], 'monthly_history_sha256': 'fixed',
                'by_spark': {'spark1': {'count': 30, 'latest': 500}}}

    def backup(stream):
        stream.write(b'fixture backup')
        return {**expected, 'by_spark': {'spark1': {'count': 20, 'latest': 500}}}

    host._preview_energy = backup
    destination = tmp_path/'electricity.sqlite3'
    with pytest.raises(RuntimeError, match='continuity changed'):
        host.archive_preview_energy(destination, expected=expected)
    assert not destination.exists()
    assert destination.with_suffix('.incomplete').is_file()
