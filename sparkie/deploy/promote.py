"""Execute an exact approved first cutover, or restore its retained predecessor.

The operator must supply the reviewed plan hash. Preparation does not authorize
running this file. Every phase is recorded before dispatch; an interrupted
promotion cannot be repeated. Rollback reconciles current route/service/model
state and keeps both assistant histories. No command runs on import.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import pwd
import re
import shlex
import subprocess
import sys
import tarfile
import time
import urllib.error
import urllib.request

from candidate import sha
from installation import (PREVIEW_ROUTE_PORT, UNITS, inherited_energy_path, protected_ancestry,
                          read_plan, require_distinct_preview_port, uses_preview_route)
from model_unit import docker, inspect_container
from serve_route import (ServeAPI, change, replacement, route, change_services,
                         services_replacement, services_route)

OLD_UNITS = ('spark-console-watchdog.timer', 'spark-console-watchdog.service', 'spark-console-api.service')
NEW_UNITS = ('sparkie-main-brain.service', 'sparkie-fleet.service', 'hermes-gateway.service', 'sparkie-collector.timer')
ROLLBACK_COMPLETE = 'old-services-restored-owner-path-needs-verification'
ROLLBACK_EDITORS_PENDING = 'old-hub-restored-editors-pending'
PREVIEW_TIMER = 'sparkie-ui-observations.timer'
PREVIEW_COLLECTOR = 'sparkie-ui-observations.service'
LEGACY_EDITORS = (('compute2-endpoint.invalid', 'spark-portal-spark4-tunnel.service'),
                  ('compute2-endpoint.invalid', 'spark-portal-editor.service'),
                  ('compute3-endpoint.invalid', 'spark-portal-editor.service'),
                  ('compute4-endpoint.invalid', 'spark-portal-editor.service'))


class Journal:
    def __init__(self, directory, *, plan_hash=None):
        self.directory = Path(directory)
        if plan_hash is not None:
            self.directory.mkdir(mode=0o700)
            self.data = {'schema': 1, 'operation_id': self.directory.name, 'plan_sha256': plan_hash,
                         'state': 'preparing', 'events': []}
            self.save()
        else:
            protected_ancestry(self.directory)
            self.data = json.loads((self.directory / 'operation.json').read_text())

    def save(self):
        path = self.directory / 'operation.json'
        temporary = self.directory / 'operation.new'
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w') as stream:
            json.dump(self.data, stream, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        fd = os.open(self.directory, os.O_RDONLY | os.O_DIRECTORY)
        try: os.fsync(fd)
        finally: os.close(fd)

    def step(self, name, action):
        entry = {'phase': name, 'state': 'dispatching', 'at': datetime.now(timezone.utc).isoformat()}
        self.data['events'].append(entry)
        self.save()
        result = action()
        entry['state'] = 'observed_complete'
        self.save()
        return result


class Host:
    def __init__(self, plan):
        self.plan, self.settings = plan, plan['settings']
        self.user = pwd.getpwnam(self.settings['user'])

    def systemctl(self, *args, legacy=False, check=True):
        argv = ['/usr/bin/systemctl', *args]
        if legacy:
            argv = ['/usr/sbin/runuser', '--user', self.user.pw_name, '--', '/usr/bin/env', '-i',
                'PATH=/usr/bin:/bin', 'HOME=' + self.user.pw_dir, 'XDG_RUNTIME_DIR=/run/user/' + str(self.user.pw_uid),
                'DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/' + str(self.user.pw_uid) + '/bus',
                '/usr/bin/systemctl', '--user', *args]
        result = subprocess.run(argv, capture_output=True, text=True, timeout=600)
        if check and result.returncode:
            raise RuntimeError('The requested service phase failed; its journal remains pending. Inspect systemd privately.')
        return result

    def editor(self, target, action):
        if target not in LEGACY_EDITORS or action not in ('observe', 'retire', 'enable', 'start'):
            raise ValueError('Only the exactly reviewed old editor connections may be retired.')
        host, unit = target
        command = (['systemctl', '--user', 'show', unit, '--property=ActiveState', '--property=UnitFileState']
                   if action == 'observe' else ['systemctl', '--user', *(['disable', '--now'] if action == 'retire' else [action]), unit])
        result = subprocess.run(['/usr/sbin/runuser', '--user', self.user.pw_name, '--', '/usr/bin/env', '-i',
            'PATH=/usr/bin:/bin', 'HOME=' + self.user.pw_dir, '/usr/bin/ssh', '-o', 'BatchMode=yes',
            '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=5', '-o', 'ConnectionAttempts=1',
            self.user.pw_name + '@' + host, shlex.join(command)], capture_output=True, text=True, timeout=30)
        if result.returncode: raise RuntimeError('The reviewed old editor service result is uncertain; inspect the saved operation.')
        if action == 'observe':
            rows = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)
            if set(rows) != {'ActiveState', 'UnitFileState'}:
                raise RuntimeError('The old editor service state could not be verified.')
            return rows
        if action == 'retire':
            observed = self.editor(target, 'observe')
            if observed['ActiveState'] not in ('inactive', 'failed') or observed['UnitFileState'] != 'disabled':
                raise RuntimeError('The old editor retirement was not verified.')
        elif action in ('enable', 'start'):
            observed = self.editor(target, 'observe')
            key, expected = ('UnitFileState', 'enabled') if action == 'enable' else ('ActiveState', 'active')
            if observed[key] != expected:
                raise RuntimeError('The old editor restoration was not verified.')
            return observed

    def unit_state(self, name, *, legacy=False):
        return {kind: self.systemctl('is-' + kind, name, legacy=legacy, check=False).stdout.strip()
                for kind in ('active', 'enabled')}

    def stop(self, names, *, legacy=False):
        for name in names:
            self.systemctl('stop', name, legacy=legacy)
            if self.unit_state(name, legacy=legacy)['active'] not in ('inactive', 'failed'):
                raise RuntimeError('A service is still active; no later phase was dispatched.')

    def start(self, names, *, legacy=False):
        for name in names:
            self.systemctl('start', name, legacy=legacy)
            if self.unit_state(name, legacy=legacy)['active'] != 'active':
                raise RuntimeError('A required service has not become active.')

    def old_brain(self, running):
        row = self.old_brain_state()
        identity = self.settings['legacy_brain_id']
        if row != running:
            result = docker(*(['start', identity] if running else ['stop', '--time', '45', identity]), timeout=90)
            if result.returncode: raise RuntimeError('Old brain result uncertain; inspect before retrying.')
        if self.old_brain_state() != running:
            raise RuntimeError('Old brain result could not be verified.')

    def old_brain_state(self):
        identity = self.settings['legacy_brain_id']
        row = inspect_container(identity)
        if row.get('Id') != identity or row.get('Image') != self.settings['legacy_brain_image_id']:
            raise RuntimeError('The retained old brain identity changed; no container was acted on.')
        return row['State']['Running']

    def archive(self, destination):
        source = Path(self.settings['legacy_state'])
        if not source.is_dir() or source.is_symlink():
            raise ValueError('The verified legacy state directory is unavailable.')
        # Old API is stopped first so SQLite and its related files are stable.
        with tarfile.open(destination, 'x:gz', dereference=False) as archive:
            archive.add(source, arcname='legacy-assistant-state', recursive=True)
        destination.chmod(0o600)

    def import_energy(self):
        # The old writer is stopped and its complete state is archived first.
        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
        from sparkie_sparks.energy_history import import_monthly
        result = import_monthly(Path(self.settings['legacy_state']) / 'energy.json',
                                self.settings['energy_database'])
        path = Path(self.settings['energy_database'])
        os.chown(path, self.plan['uid'], self.plan['gid'])
        path.chmod(0o600)
        return result

    def preview_state(self):
        preview = self.settings['preview_dashboard']
        row = inspect_container(preview['container_id'])
        if (row.get('Id') != preview['container_id'] or row.get('Image') != preview['image_id']
                or row.get('Config', {}).get('Labels', {}).get('sparkie.role') != 'native-dashboard'):
            raise RuntimeError('The retained native dashboard identity changed; nothing was stopped.')
        running = row['State']['Running']
        if running and uses_preview_route(self.settings.get('expected_route', {})):
            published = row.get('NetworkSettings', {}).get('Ports') or {}
            if {'HostIp': '127.0.0.1', 'HostPort': str(PREVIEW_ROUTE_PORT)} not in (
                advertised for bindings in published.values() for advertised in (bindings or ())
            ):
                raise RuntimeError('The retained preview does not serve the reviewed loopback route.')
        config = row['Config']
        environment = config.get('Env') or []
        mounts = row.get('Mounts') or []
        internal_data = '/data/observations'
        energy = inherited_energy_path(self.settings)
        has_preview_energy = ('sparkie.ui-manifest' in config['Labels']
                              or any(entry.startswith(f'SPARKIE_ENERGY_DATABASE={internal_data}/') for entry in environment)
                              or any(m.get('Destination') == internal_data for m in mounts))
        if energy is None and has_preview_energy:
            raise RuntimeError('The published native preview requires its inherited electricity database in the reviewed plan.')
        if energy is not None:
            internal_home = str(Path(self.user.pw_dir) / '.hermes')
            expected = {'HERMES_HOME': internal_home, 'SPARKIE_ENERGY_DATABASE': f'{internal_data}/{energy.name}'}

            def bound(source, destination, writable):
                covering = [m for m in mounts if m['Destination'] == destination
                            or m['Destination'].startswith(destination + '/')]
                return len(covering) == 1 and all(
                    covering[0].get(key) == value for key, value in {
                        'Type': 'bind', 'Source': str(source), 'Destination': destination, 'RW': writable,
                    }.items())

            if (config.get('User') != f"{self.plan['uid']}:{self.plan['gid']}"
                    or any([entry for entry in environment if entry.startswith(key + '=')] != [key + '=' + value]
                           for key, value in expected.items())
                    or not bound(preview['home'], internal_home, True)
                    or not bound(energy.parent, internal_data, False)):
                raise RuntimeError('The retained dashboard home or electricity mount changed; nothing was stopped.')
        return running

    def preview_running(self, running):
        if self.preview_state() != running:
            identifier = self.settings['preview_dashboard']['container_id']
            result = docker(*(['start', identifier] if running else ['stop', '--time', '15', identifier]), timeout=45)
            if result.returncode:
                raise RuntimeError('The native dashboard result is uncertain; inspect the saved operation.')
        if self.preview_state() != running:
            raise RuntimeError('The retained native dashboard state could not be verified.')

    def _runtime(self, command, *, environment=(), **options):
        selector = ['/usr/sbin/runuser', '--user', self.user.pw_name, '--', '/usr/bin/env', '-i',
                    'PATH=/usr/bin:/bin', 'HOME=' + self.user.pw_dir]
        return subprocess.run([*selector, *environment, *command], **options)

    def preserve_preview_preferences(self, archive_path):
        preview = self.settings['preview_dashboard']
        was_running = self.preview_state()
        if was_running:
            self.preview_running(False)
        try:
            source = Path(preview['home'])
            if not source.is_dir() or source.is_symlink():
                raise ValueError('The retained native settings home is unavailable.')
            temporary = archive_path.with_suffix('.incomplete')
            with temporary.open('xb') as archive:
                os.fchmod(archive.fileno(), 0o600)
                saved = self._runtime(['/usr/bin/tar', '-czf', '-', r'--transform=flags=rh;s,^\.,native-ui-state,',
                                       '-C', str(source), '--', '.'],
                                      stdout=archive, stderr=subprocess.PIPE, timeout=60)
                if saved.returncode:
                    raise RuntimeError('The runtime user could not archive the paused dashboard home.')
                os.fsync(archive.fileno())
            temporary.rename(archive_path)
            native = Path(self.settings['candidate']) / 'hermes'
            importer = Path(__file__).resolve().with_name('managed_config.py')
            result = self._runtime([str(native / '.venv/bin/python'), '-B', str(importer),
                                    '--home', self.settings['home'], '--import-preview', str(source),
                                    '--runtime-uid', str(self.plan['uid']), '--runtime-gid', str(self.plan['gid'])],
                                   environment=('PYTHONPATH=' + str(native), 'HERMES_HOME=' + self.settings['home']),
                                   capture_output=True, timeout=60)
            if result.returncode:
                raise RuntimeError('The runtime user could not import the paused dashboard appearance.')
        except Exception:
            # Restore the existing owner page immediately if its import fails.
            if was_running:
                self.preview_running(True)
            raise

    def _verify_preview_writer(self):
        timer_target = self.systemctl('show', PREVIEW_TIMER, '--property=Unit', '--value', legacy=True).stdout.strip()
        execution = self.systemctl('show', PREVIEW_COLLECTOR, '--property=ExecStart', '--value', legacy=True).stdout
        commands = re.findall(r'argv\[\]=(.*?) ; ignore_errors=', execution)
        arguments = shlex.split(commands[0]) if len(commands) == 1 else []
        databases = [argument for argument in arguments if argument == '--energy-database'
                     or argument.startswith('--energy-database=')]
        energy = str(inherited_energy_path(self.settings))
        if (timer_target != PREVIEW_COLLECTOR or arguments[1:3] != ['-m', 'sparkie_sparks.collector']
                or databases != ['--energy-database']
                or arguments[arguments.index('--energy-database') + 1:] != [energy]):
            raise RuntimeError('The installed preview observation units do not match the reviewed electricity database.')

    def _preview_energy(self, archive=None):
        # The database and its parent belong to the runtime user. Run SQLite
        # with that identity; only the journal file is opened by the operator.
        argv = [str(Path(self.settings['candidate']) / 'hermes/.venv/bin/python'), '-I',
                str(Path(__file__).resolve().with_name('preview_energy.py')), str(inherited_energy_path(self.settings)),
                str(self.plan['uid']), str(self.plan['gid'])]
        result = self._runtime(argv + (['--backup'] if archive is not None else []),
                               stdout=archive if archive is not None else subprocess.PIPE,
                               stderr=subprocess.PIPE, text=True, timeout=60)
        if result.returncode:
            raise RuntimeError('The runtime user could not inspect or archive the inherited electricity database.')
        return json.loads(result.stderr if archive is not None else result.stdout)

    def preview_energy_state(self):
        self._verify_preview_writer()
        saved = {unit: self.unit_state(unit, legacy=True) for unit in (PREVIEW_TIMER, PREVIEW_COLLECTOR)}
        if (saved[PREVIEW_TIMER]['enabled'] not in ('enabled', 'disabled')
                or saved[PREVIEW_TIMER]['active'] not in ('active', 'inactive', 'failed')):
            raise RuntimeError('The preview observation timer state could not be verified.')
        return {'units': saved, 'database': self._preview_energy()}

    def pause_preview_energy(self):
        self._verify_preview_writer()
        self.stop((PREVIEW_TIMER,), legacy=True)
        self.systemctl('disable', PREVIEW_TIMER, legacy=True)
        self.stop((PREVIEW_COLLECTOR,), legacy=True)
        if self.unit_state(PREVIEW_TIMER, legacy=True)['enabled'] != 'disabled':
            raise RuntimeError('The preview timer remains enabled; the new collector was not started.')

    def archive_preview_energy(self, destination, *, expected):
        timer = self.unit_state(PREVIEW_TIMER, legacy=True)
        collector = self.unit_state(PREVIEW_COLLECTOR, legacy=True)
        if (timer['enabled'] != 'disabled' or timer['active'] not in ('inactive', 'failed')
                or collector['active'] not in ('inactive', 'failed')):
            raise RuntimeError('The preview writer did not stay paused; no archive was taken.')
        temporary = destination.with_suffix('.incomplete')
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'wb') as archive:
            os.fchmod(archive.fileno(), 0o600)
            summary = self._preview_energy(archive)
            os.fsync(archive.fileno())
        if (summary['database_identity'] != expected['database_identity']
                or summary['monthly_history_sha256'] != expected['monthly_history_sha256']
                or any(spark not in summary['by_spark']
                       or summary['by_spark'][spark]['count'] < row['count']
                       or summary['by_spark'][spark]['latest'] < row['latest']
                       for spark, row in expected['by_spark'].items())):
            raise RuntimeError('Electricity continuity changed during warmup; the new collector was not started.')
        temporary.rename(destination)
        return {**summary, 'archive_sha256': sha(destination)}

    def restore_preview_energy(self, saved):
        self._verify_preview_writer()
        state = saved['units'][PREVIEW_TIMER]
        current = self.unit_state(PREVIEW_TIMER, legacy=True)
        if current['enabled'] != state['enabled']:
            self.systemctl('enable' if state['enabled'] == 'enabled' else 'disable', PREVIEW_TIMER, legacy=True)
        if state['active'] == 'active':
            if current['active'] != 'active':
                self.start((PREVIEW_TIMER,), legacy=True)
        elif current['active'] not in ('inactive', 'failed'):
            self.stop((PREVIEW_TIMER,), legacy=True)
        observed = self.unit_state(PREVIEW_TIMER, legacy=True)
        active = {'active'} if state['active'] == 'active' else {'inactive', 'failed'}
        if observed['enabled'] != state['enabled'] or observed['active'] not in active:
            raise RuntimeError('The prior preview observation timer state could not be restored.')
        # Restoring the timer schedules the next run. Never replay a captured
        # in-flight oneshot or replace the database with the archived snapshot.

    def disable_native_collector(self):
        unit = 'sparkie-collector.timer'
        self.systemctl('disable', unit)
        state = self.unit_state(unit)
        if state['enabled'] != 'disabled' or state['active'] not in ('inactive', 'failed'):
            raise RuntimeError('The native timer is still active or enabled; the preview writer was not restored.')

    def private_service_ingress(self):
        from service_ingress import UNIT
        port = self.settings['service_ingress']['port']
        client = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        deadline = time.monotonic() + 15
        while True:
            if self.unit_state(UNIT)['active'] != 'active':
                raise RuntimeError('The workload ingress stopped before its owner gate could be checked.')
            try:
                response = client.open(f'http://127.0.0.1:{port}/services/artifact-browser/', timeout=3)
            except urllib.error.HTTPError as error:
                if error.code == 401:
                    return True
                raise RuntimeError('The workload ingress did not return its native sign-in gate.') from None
            except urllib.error.URLError:
                if time.monotonic() >= deadline:
                    raise RuntimeError('The workload ingress did not become ready.') from None
                time.sleep(0.2)
            else:
                response.close()
                raise RuntimeError('The workload ingress unexpectedly allowed an anonymous request.')

    def private_gateway(self):
        base = 'http://127.0.0.1:' + str(self.settings['gateway_port'])
        client = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            try:
                with client.open(base + '/login', timeout=3) as response:
                    if response.status != 200: raise RuntimeError('Owner sign-in is unavailable.')
                try:
                    response = client.open(base + '/api/config', timeout=3)
                except urllib.error.HTTPError as error:
                    if error.code == 401: return
                    raise RuntimeError('The owner API gate returned an unexpected result.') from None
                else:
                    response.close()
                    raise RuntimeError('The owner API did not require sign-in; public routing remains unchanged.')
            except urllib.error.HTTPError as error:
                if error.code not in (502, 503):
                    raise RuntimeError('Owner sign-in returned an unexpected result.') from None
            except (urllib.error.URLError, TimeoutError, ConnectionError):
                pass  # Startup observation only; never restart a service here.
            if self.unit_state('hermes-gateway.service')['active'] not in ('active', 'activating'):
                raise RuntimeError('The native gateway stopped before its private owner gate was ready.')
            time.sleep(.5)
        raise RuntimeError('The native owner gate exceeded its90-second startup budget; public routing is unchanged.')


def validate(plan, directory):
    if os.geteuid() != 0: raise PermissionError('The approved cutover requires the administrator.')
    if Path('/etc/machine-id').read_text().strip() != plan['host_machine_id']:
        raise ValueError('This approved plan belongs only to Spark1.')
    protected_ancestry(directory)
    for name, digest in plan['files'].items():
        if name.endswith(('.service', '.timer', '.socket')):
            target = Path('/etc/systemd/system') / name
            protected_ancestry(target)
            if sha(target) != digest: raise ValueError('A staged service differs from the approved plan.')
        elif name == 'service-ingress.Caddyfile':
            from service_ingress import CONFIG
            protected_ancestry(CONFIG)
            if sha(CONFIG) != digest:
                raise ValueError('The staged workload ingress differs from the approved plan.')


def promote(plan, plan_hash, journal, *, host, api):
    settings = plan['settings']
    preview = settings.get('preview_dashboard')
    inherited_energy = inherited_energy_path(settings)
    before, _ = api.read()
    previous_route = route(before)
    if previous_route != settings['expected_route']:
        raise RuntimeError('The reviewed old8443 handlers changed; no service was stopped.')
    ingress = settings.get('service_ingress')
    if ingress is not None:
        if services_route(before) != ingress['expected_route']:
            raise RuntimeError('The reviewed workload route changed; no service was stopped.')
        journal.data['old_services_route'] = services_route(before)
    require_distinct_preview_port(settings)
    serving_preview = uses_preview_route(previous_route)
    if not preview and serving_preview:
        raise RuntimeError('The published native dashboard must be included as a retained preview.')
    journal.data['old_route'] = previous_route
    journal.data['old_units'] = {name: host.unit_state(name, legacy=True) for name in OLD_UNITS}
    journal.data['old_brain_running'] = host.old_brain_state()
    if preview:
        journal.data['preview_running'] = host.preview_state()
        if serving_preview and not journal.data['preview_running']:
            raise RuntimeError('The reviewed preview is stopped; identify the active dashboard before cutover.')
    if inherited_energy is not None:
        journal.data['preview_energy'] = host.preview_energy_state()
    journal.data['old_editors'] = [{'host': target[0], 'unit': target[1], 'state': host.editor(target, 'observe')}
                                 for target in LEGACY_EDITORS]
    for entry in journal.data['old_editors']:
        check_editor_predecessor(entry['state'])
    if journal.data['old_units']['spark-console-api.service']['active'] != 'active':
        raise RuntimeError('The expected legacy application is not active; inspect before replacing it.')
    # Captured state has no credentials. The separate archive remains private.
    journal.data['state'] = 'promoting'
    journal.save()
    journal.step('stop-old-watchdog-and-poller', lambda: host.stop(OLD_UNITS, legacy=True))
    journal.step('archive-old-assistant-state', lambda: host.archive(journal.directory / 'legacy-state.tar.gz'))
    if settings.get('legacy_state') and inherited_energy is None:
        journal.data['electricity_history'] = journal.step('preserve-monthly-electricity', host.import_energy)
        journal.save()
    journal.step('stop-retained-old-brain', lambda: host.old_brain(False))
    for target in LEGACY_EDITORS:
        journal.step('retire-' + target[0] + '-' + target[1], lambda target=target: host.editor(target, 'retire'))
    def switch_route():
        return change(api, expected=journal.data['old_route'], target=replacement(settings['gateway_port']))

    if preview:
        brain, fleet, gateway, collector = NEW_UNITS
        # The model unit waits for server readiness in ExecStartPost. Keep the
        # preview live so appearance edits are captured immediately before swap.
        journal.step('warm-native-brain-and-controller', lambda: host.start((brain, fleet)))
        switching_route = False
        launching_gateway = False
        try:
            if inherited_energy is not None:
                journal.step('pause-preview-electricity-writer', host.pause_preview_energy)
                journal.data['electricity_history'] = journal.step(
                    'archive-inherited-electricity',
                    lambda: host.archive_preview_energy(journal.directory / 'preview-electricity.sqlite3',
                                                        expected=journal.data['preview_energy']['database']))
                journal.save()
            journal.step('preserve-native-ui-preferences', lambda: host.preserve_preview_preferences(journal.directory / 'native-ui-state.tar.gz'))
            launching_gateway = True
            journal.step('start-native-gateway', lambda: host.start((gateway,)))
            journal.step('verify-private-owner-gate', host.private_gateway)
            switching_route = True
            journal.step('switch-only8443', switch_route)
        except Exception:
            if not switching_route or route(api.read()[0]) == journal.data['old_route']:
                if launching_gateway:
                    journal.step('stop-native-gateway-after-failed-swap', lambda: host.stop((gateway,)))
                if journal.data['preview_running']:
                    journal.step('restore-native-preview-after-failed-swap', lambda: host.preview_running(True))
                if inherited_energy is not None:
                    journal.step('restore-preview-electricity-after-failed-swap',
                                 lambda: host.restore_preview_energy(journal.data['preview_energy']))
            raise
        journal.step('start-native-collector', lambda: host.start((collector,)))
    else:
        journal.step('start-native-services', lambda: host.start(NEW_UNITS))
        journal.step('verify-private-owner-gate', host.private_gateway)
        journal.step('switch-only8443', switch_route)
    if ingress is not None:
        from service_ingress import UNIT
        journal.step('start-authenticated-workload-ingress', lambda: host.start((UNIT,)))
        journal.step('verify-private-workload-gate', host.private_service_ingress)
        journal.step('publish-authenticated-workload-origin', lambda: change_services(
            api, expected=journal.data['old_services_route'], target=services_replacement(ingress['port'])))
        journal.step('enable-workload-ingress', lambda: host.systemctl('enable', UNIT))
    if settings.get('application_updates'):
        from upgrade_installation import SOCKET
        journal.step('start-reviewed-update-socket', lambda: host.start((SOCKET,)))
        journal.step('enable-reviewed-update-socket', lambda: host.systemctl('enable', SOCKET))
    # Persistent boot policy changes only after the private gate and route proof.
    journal.step('disable-old-autostart', lambda: host.systemctl('disable', *OLD_UNITS, legacy=True))
    journal.step('enable-native-autostart', lambda: host.systemctl('enable', *NEW_UNITS))
    journal.data['state'] = 'awaiting-owner-browser-websocket-telegram-verification'
    journal.save()
    return journal.data['state']


def restore_hub(plan, journal, host, api):
    journal.data['state'] = 'rolling-back'
    journal.save()
    if plan['settings'].get('application_updates'):
        from upgrade_installation import SOCKET
        journal.step('stop-reviewed-update-socket', lambda: host.stop((SOCKET,)))
        journal.step('disable-reviewed-update-socket', lambda: host.systemctl('disable', SOCKET))
    if 'old_services_route' in journal.data:
        from service_ingress import UNIT
        journal.step('restore-workload-origin', lambda: change_services(
            api, expected=services_replacement(plan['settings']['service_ingress']['port']),
            target=journal.data['old_services_route']))
        journal.step('stop-workload-ingress', lambda: host.stop((UNIT,)))
        journal.step('disable-workload-ingress', lambda: host.systemctl('disable', UNIT))
    # Stop the new poller before restoring the old service. Keep all new state.
    journal.step('stop-new-poller-and-collector', lambda: host.stop(('hermes-gateway.service', 'sparkie-collector.timer', 'sparkie-collector.service')))
    boot_units = NEW_UNITS
    if 'preview_energy' in journal.data:
        journal.step('disable-native-collector-autostart', host.disable_native_collector)
        boot_units = NEW_UNITS[:-1]
        journal.step('restore-preview-electricity-writer', lambda: host.restore_preview_energy(journal.data['preview_energy']))
    if 'preview_running' in journal.data:
        journal.step('restore-native-preview-state', lambda: host.preview_running(journal.data['preview_running']))
    journal.step('restore-only8443', lambda: change(api, expected=replacement(plan['settings']['gateway_port']), target=journal.data['old_route']))
    journal.step('stop-new-brain-and-controller', lambda: host.stop(('sparkie-main-brain.service', 'sparkie-fleet.service')))
    journal.step('disable-new-autostart', lambda: host.systemctl('disable', *boot_units))
    journal.step('restore-retained-old-brain-state', lambda: host.old_brain(journal.data['old_brain_running']))
    for name in reversed(OLD_UNITS):
        saved = journal.data['old_units'][name]
        if saved['enabled'] == 'enabled':
            journal.step('restore-autostart-' + name, lambda name=name: host.systemctl('enable', name, legacy=True))
        # The watchdog oneshot is triggered by its restored timer. Replaying a
        # captured mid-run oneshot could duplicate the prior check.
        if saved['active'] == 'active' and name != 'spark-console-watchdog.service':
            journal.step('restore-running-' + name, lambda name=name: host.start((name,), legacy=True))
    journal.data['state'] = ROLLBACK_EDITORS_PENDING
    journal.save()


def check_editor_predecessor(saved):
    if (saved['UnitFileState'] not in ('enabled', 'disabled')
            or saved['ActiveState'] not in ('active', 'inactive', 'failed')):
        raise RuntimeError('The old editor has a transient or unsupported state. Review it before handover.')


def restore_editor(host, journal, target, saved):
    # An SSH reply can be lost after systemd acted. Read both properties before
    # deciding which part, if any, is still needed on this specific worker.
    check_editor_predecessor(saved)
    observed = host.editor(target, 'observe')
    label = '-'.join(target)
    if ((saved['UnitFileState'] == 'disabled' and observed['UnitFileState'] != 'disabled')
            or (saved['ActiveState'] != 'active' and observed['ActiveState'] not in ('inactive', 'failed'))):
        raise RuntimeError('The editor gained a running or boot state outside this retirement. Review it before recovery.')
    if saved['UnitFileState'] == 'enabled' and observed['UnitFileState'] != 'enabled':
        if observed['UnitFileState'] != 'disabled':
            raise RuntimeError('The editor boot policy changed. Inspect it before recovery.')
        observed = journal.step('restore-enable-' + label, lambda: host.editor(target, 'enable'))
    if saved['ActiveState'] == 'active' and observed['ActiveState'] != 'active':
        if observed['ActiveState'] not in ('inactive', 'failed'):
            raise RuntimeError('The editor has not reached a stable state. Recheck before recovery.')
        observed = journal.step('restore-running-' + label, lambda: host.editor(target, 'start'))
    expected_active = ('active',) if saved['ActiveState'] == 'active' else ('inactive', 'failed')
    if observed['UnitFileState'] != saved['UnitFileState'] or observed['ActiveState'] not in expected_active:
        raise RuntimeError('The observed editor state differs from its recorded predecessor.')


def rollback(plan, journal, *, host, api):
    if journal.data['state'] == ROLLBACK_COMPLETE:
        return ROLLBACK_COMPLETE
    if 'old_route' not in journal.data or 'old_units' not in journal.data:
        raise ValueError('This operation did not save a predecessor; nothing is restored automatically.')
    if journal.data['state'] != ROLLBACK_EDITORS_PENDING:
        restore_hub(plan, journal, host, api)
    # A saved observation is not an attempted retirement. A dispatch with a
    # lost reply does count. Recover reachable workers even if another is off.
    phases = {event['phase']: event['state'] for event in journal.data['events']}
    pending = []
    for entry in reversed(journal.data.get('old_editors', [])):
        target = (entry['host'], entry['unit'])
        label = '-'.join(target)
        check = 'reconcile-editor-' + label
        if 'retire-' + label not in phases or phases.get(check) == 'observed_complete':
            continue
        try:
            journal.step(check, lambda: restore_editor(host, journal, target, entry['state']))
        except (RuntimeError, subprocess.TimeoutExpired) as error:
            pending.append(f'{label} ({error})')
    if pending:
        raise RuntimeError('Hub services restored. Recheck the same rollback for ' + ', '.join(pending))
    journal.data['state'] = ROLLBACK_COMPLETE
    journal.save()
    return journal.data['state']


def reviewed_rollback(operation, plan_hash):
    journal = Journal(operation)
    if journal.data['plan_sha256'] != plan_hash:
        raise ValueError('Rollback requires this operation’s exact approved plan.')
    return journal


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['promote', 'rollback'])
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--approved-plan-sha256', required=True)
    parser.add_argument('--operation', type=Path, required=True)
    args = parser.parse_args()
    # A lost reply to a finished rollback needs only its protected, plan-bound receipt.
    # Rechecking current units or acquiring the update lock could disturb a later handover.
    if args.action == 'rollback':
        recorded = reviewed_rollback(args.operation, args.approved_plan_sha256)
        if recorded.data['state'] == ROLLBACK_COMPLETE:
            print(ROLLBACK_COMPLETE)
            raise SystemExit(0)
    plan = read_plan(args.directory, args.approved_plan_sha256)
    validate(plan, args.directory)
    protected_ancestry(args.operation.parent)
    from contextlib import nullcontext
    lock = nullcontext()
    if plan['settings'].get('application_updates'):
        from upgrade_installation import initial_handover
        lock = initial_handover(Path(plan['settings']['candidate']))
    with lock:
        if args.action == 'promote':
            journal = Journal(args.operation, plan_hash=args.approved_plan_sha256)
            result = promote(plan, args.approved_plan_sha256, journal, host=Host(plan), api=ServeAPI())
        else:
            journal = reviewed_rollback(args.operation, args.approved_plan_sha256)
            result = rollback(plan, journal, host=Host(plan), api=ServeAPI())
    print(result)
