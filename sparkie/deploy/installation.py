"""Render and stage a concrete first Hermes installation; never start services.

Run render with the candidate interpreter. Administrator-only stage installs
the reviewed files and fresh protected home but leaves the old application and
routes running. Promotion is a separate exact approved operation.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import stat
import subprocess

from candidate import sha, verify
from protected_home import prepare as prepare_home
from service_unit import render as gateway_unit, render_collector, render_collector_timer, _literal
from model_unit import render as model_unit
from serve_route import replacement

UNITS = ('hermes-gateway.service', 'sparkie-fleet.service', 'sparkie-collector.service',
         'sparkie-collector.timer', 'sparkie-main-brain.service')
KEYS = {'candidate', 'home', 'user', 'controller_config', 'inventory', 'plugs', 'fleet_snapshot',
        'energy_database', 'control_socket', 'model_weights', 'model_cache', 'environment', 'gateway_port',
        'legacy_brain_id', 'legacy_brain_image_id', 'legacy_state', 'expected_route', 'state_root'}
OPTIONAL_KEYS = {'preview_dashboard', 'service_ingress', 'application_updates'}
PREVIEW_ROUTE_PORT = 32130


def all_units(settings):
    from service_ingress import UNIT
    units = (*UNITS, UNIT) if 'service_ingress' in settings else UNITS
    if settings.get('application_updates'):
        from upgrade_installation import SOCKET, SERVICE
        return (*units, SOCKET, SERVICE)
    return units


def installation_files(settings):
    files = (*all_units(settings), 'config.yaml')
    return (*files, 'service-ingress.Caddyfile') if 'service_ingress' in settings else files


def validate_ingress(settings):
    from service_ingress import render as render_ingress
    selected = settings.get('service_ingress')
    if selected is None:
        return None
    if not isinstance(selected, dict) or set(selected) != {'origin', 'port', 'expected_route'}:
        raise ValueError('Review the complete separate workload ingress settings.')
    if (not isinstance(selected['expected_route'], dict)
            or set(selected['expected_route']) != {'tcp', 'web', 'funnel'}):
        raise ValueError('Record the existing workload route, including its absence.')
    return render_ingress(dashboard_origin='https://hub.example.invalid:8443',
                          services_origin=selected['origin'], dashboard_port=settings['gateway_port'],
                          listen_port=selected['port'])


def environment_file(path):
    """This systemd directive takes a bare absolute filename, not ExecStart quoting."""
    value = str(path)
    _literal(value)
    if not Path(value).is_absolute() or any(char.isspace() for char in value):
        raise ValueError('Use an absolute private environment path without whitespace.')
    return 'EnvironmentFile=' + value


def uses_preview_route(handlers):
    return handlers.get('Handlers', {}).get('/') == replacement(PREVIEW_ROUTE_PORT)['Handlers']['/']


def require_distinct_preview_port(settings):
    if settings['gateway_port'] == PREVIEW_ROUTE_PORT and uses_preview_route(settings['expected_route']):
        raise ValueError('The native gateway needs a different port from the published preview before the owner gate is checked.')


def protected_ancestry(entry):
    """Do not let a writable directory replace a checked immutable file."""
    path = Path(entry)
    for item in (path, *path.parents):
        info = item.lstat()
        if stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise ValueError('Protected installation paths need root-owned, non-writable ancestry.')


def config_files(settings):
    """Enumerate only the controller's maintained private configuration links."""
    paths = {Path(settings[key]) for key in ('controller_config', 'inventory', 'plugs', 'environment')}
    if settings.get('service_ingress'):
        if re.search(rb'(?m)^[ \t]*SPARKIE_SERVICES_ORIGIN[ \t]*=', Path(settings['environment']).read_bytes()):
            raise ValueError('The private environment must not override the reviewed workload origin.')
    if inherited_energy_path(settings) is not None:
        private_environment = Path(settings['environment']).read_bytes()
        if re.search(rb'(?m)^[ \t]*SPARKIE_ENERGY_DATABASE[ \t]*=', private_environment):
            raise ValueError('The private environment would override the reviewed electricity path.')
    controller = json.loads(Path(settings['controller_config']).read_text())
    updates = False
    if 'application_updates' in settings or 'application_updates' in controller:
        from upgrade_installation import validate
        updates = validate(settings, controller)
    if controller.get('notifications'):
        candidate = Path(settings['candidate'])
        if updates:
            from upgrade import CURRENT
            candidate = CURRENT
        expected = {'home': settings['home'], 'environment': settings['environment'],
                    'python': str(candidate / 'hermes/.venv/bin/python'), 'source': str(candidate / 'hermes')}
        if controller['notifications'] != expected:
            raise ValueError('Native notices must use this same reviewed home, environment and candidate.')
    for key in ('owner_binding', 'compute_config', 'service_config'):
        if controller.get(key): paths.add(Path(controller[key]))
    for key in ('mapping', 'qualification'):
        if controller.get('power', {}).get(key): paths.add(Path(controller['power'][key]))
    if any(not path.is_absolute() for path in paths):
        raise ValueError('Every private configuration dependency needs an absolute path.')
    return sorted(paths)


def inherited_energy_path(settings):
    preview = settings.get('preview_dashboard') or {}
    if 'energy_database' not in preview:
        return None
    value = preview['energy_database']
    if not isinstance(value, str) or value != settings['energy_database']:
        raise ValueError('The inherited electricity path must exactly match the native runtime path.')
    path = Path(value)
    if (not path.is_absolute() or '..' in path.parts or str(path) != value
            or path.is_relative_to(Path(settings['state_root']))):
        raise ValueError('The existing electricity database needs its own reviewed absolute path outside fresh state.')
    return path


def mutable_paths(settings):
    root = Path(settings['state_root'])
    values = [Path(settings[key]).parent for key in ('fleet_snapshot', 'control_socket')]
    if inherited_energy_path(settings) is None:
        values.append(Path(settings['energy_database']).parent)
    controller = json.loads(Path(settings['controller_config']).read_text())
    values.append(Path(controller['operations']).parent)
    if controller.get('service_relay'):
        values.append(Path(controller['service_relay']['directory']))
    if controller.get('compute_config'):
        compute = json.loads(Path(controller['compute_config']).read_text())
        values.append(Path(compute['credentials_dir']))
    if '..' in root.parts or any('..' in path.parts or not path.is_relative_to(root) for path in values):
        raise ValueError('Controller state must stay under the reviewed private state root.')
    return sorted(set([root, *values]), key=lambda value: (len(value.parts), str(value)))


def render(settings, output):
    from ruamel.yaml import YAML
    if (not isinstance(settings, dict) or not KEYS <= set(settings)
            or set(settings) - KEYS - OPTIONAL_KEYS):
        raise ValueError('Use the complete reviewed first-installation settings.')
    root = Path(settings['candidate']).resolve(strict=True)
    verify(root)
    if Path(__file__).resolve().parent != root / 'extension/deploy':
        raise ValueError('Render with the candidate’s packaged installation code.')
    user = pwd.getpwnam(settings['user'])
    if user.pw_uid == 0:
        raise ValueError('Run native Hermes and its checked controller as a non-root user.')
    for key in KEYS - {'user', 'gateway_port', 'legacy_brain_id', 'legacy_brain_image_id', 'expected_route'}:
        if not Path(settings[key]).is_absolute():
            raise ValueError('Installation paths must be absolute and reviewed.')
        _literal(settings[key])
    if not 1024 <= settings['gateway_port'] <= 65535:
        raise ValueError('Use an unprivileged gateway port.')
    require_distinct_preview_port(settings)
    ingress_config = validate_ingress(settings)
    if not re.fullmatch('[a-f0-9]{64}', settings['legacy_brain_id']) or not re.fullmatch('sha256:[a-f0-9]{64}', settings['legacy_brain_image_id']):
        raise ValueError('Record the exact retained old brain for rollback.')
    preview = settings.get('preview_dashboard')
    if preview is not None:
        identity = {'container_id', 'image_id', 'home'}
        if (not isinstance(preview, dict) or not identity <= set(preview)
                or set(preview) - identity - {'energy_database'}
                or not re.fullmatch('[a-f0-9]{64}', preview.get('container_id', ''))
                or not re.fullmatch('sha256:[a-f0-9]{64}', preview.get('image_id', ''))
                or not Path(preview.get('home', '')).is_absolute()):
            raise ValueError('Record the exact native preview container, image and home before cutover.')
        _literal(preview['home'])
    output = Path(output).resolve()
    if output.exists() or output.is_relative_to(root):
        raise ValueError('Write the reviewed installation into a new directory outside the candidate.')
    private = {str(path): sha(path) for path in config_files(settings)}
    mutable_paths(settings)
    output.mkdir(parents=True, mode=0o700)
    home = Path(settings['home'])
    common = {'SPARKIE_CONTROL_SOCKET': settings['control_socket'],
              'SPARKIE_ENERGY_DATABASE': settings['energy_database'],
              'SPARKIE_FLEET_SNAPSHOT': settings['fleet_snapshot']}
    if ingress_config is not None:
        common['SPARKIE_SERVICES_ORIGIN'] = settings['service_ingress']['origin']
    gateway = gateway_unit(root, home, user.pw_name)
    gateway += '\n[Unit]\nWants=sparkie-fleet.service sparkie-main-brain.service\nAfter=sparkie-fleet.service\n'
    gateway += '\n[Service]\n' + environment_file(settings['environment']) + '\n'
    gateway += '\n'.join('Environment=' + _literal(key + '=' + value) for key, value in common.items()) + '\n'
    python = root / 'hermes/.venv/bin/python'
    fleet = '\n'.join(['[Unit]', 'Description=Sparkie checked fleet controller', 'After=network-online.target',
        'Wants=network-online.target', '', '[Service]', 'Type=exec', 'User=' + user.pw_name,
        'ExecStart=' + ' '.join(map(_literal, (python, '-m', 'sparkie_sparks.broker', '--config', settings['controller_config']))),
        'Environment=' + _literal('PYTHONPATH=' + str(root / 'extension/src')),
        'Environment=' + _literal('SPARKIE_ENERGY_DATABASE=' + settings['energy_database']),
        'Environment="PYTHONDONTWRITEBYTECODE=1"', 'Restart=on-failure', 'RestartSec=5',
        'NoNewPrivileges=yes', 'UMask=0077', '', '[Install]', 'WantedBy=multi-user.target', ''])
    contents = {
        'hermes-gateway.service': gateway,
        'sparkie-fleet.service': fleet,
        'sparkie-collector.service': render_collector(root, user=user.pw_name, inventory=settings['inventory'],
            output=settings['fleet_snapshot'], plugs=settings['plugs'], energy_database=settings['energy_database'],
            control_socket=settings['control_socket']),
        'sparkie-collector.timer': render_collector_timer(),
        'sparkie-main-brain.service': model_unit(root / 'extension/models/main-model.json',
            weights=settings['model_weights'], cache=settings['model_cache'], group=user.pw_gid),
    }
    if ingress_config is not None:
        from service_ingress import UNIT, render_unit
        contents[UNIT] = render_unit(user.pw_name, user.pw_uid, user.pw_gid)
        contents['service-ingress.Caddyfile'] = ingress_config
    if settings.get('application_updates'):
        from upgrade import CURRENT
        from upgrade_installation import units
        if (user.pw_uid, user.pw_gid) != (1000, 1000):
            raise ValueError('The update steward requires the enrolled controller identity.')
        for name in ('hermes-gateway.service', 'sparkie-fleet.service', 'sparkie-collector.service'):
            # Keep upstream's lifecycle, flags and service environment. Route only
            # these non-root units' versioned application paths through current.
            text = contents[name]
            if 'User=' + user.pw_name not in text or str(root) + '/' not in text:
                raise ValueError('The native non-root application launcher changed.')
            contents[name] = text.replace(str(root) + '/', str(CURRENT) + '/')
        contents.update(units(user.pw_gid, home))
    for name, content in contents.items():
        (output / name).write_text(content)
    config = YAML().load(root / 'extension/config/hermes.example.yaml')
    config['webapp'] = {'enabled': True, 'host': '127.0.0.1', 'port': settings['gateway_port'],
                        'public_url': 'https://hub.example.invalid:8443'}
    with (output / 'config.yaml').open('w') as stream:
        YAML().dump(config, stream)
    plan = {'schema': 1, 'status': 'prepared-not-installed', 'candidate_sha256': sha(root / 'candidate.json'),
            'host_machine_id': 'UNENROLLED_HUB_MACHINE_ID', 'uid': user.pw_uid, 'gid': user.pw_gid,
            'settings': settings, 'private_files': private,
            'files': {name: sha(output / name) for name in installation_files(settings)}}
    (output / 'installation.json').write_text(json.dumps(plan, indent=2) + '\n')
    return sha(output / 'installation.json')


def read_plan(directory, expected_hash):
    directory = Path(directory).resolve(strict=True)
    raw = (directory / 'installation.json').read_bytes()
    if hashlib.sha256(raw).hexdigest() != expected_hash:
        raise ValueError('The exact reviewed installation plan changed.')
    plan = json.loads(raw)
    if plan['schema'] != 1 or set(plan['files']) != set(installation_files(plan['settings'])):
        raise ValueError('Unsupported first-installation plan.')
    require_distinct_preview_port(plan['settings'])
    validate_ingress(plan['settings'])
    for name, digest in plan['files'].items():
        if sha(directory / name) != digest:
            raise ValueError('A reviewed installation file changed.')
    root = Path(plan['settings']['candidate'])
    verify(root)
    if sha(root / 'candidate.json') != plan['candidate_sha256']:
        raise ValueError('The reviewed candidate changed.')
    if {str(path): sha(path) for path in config_files(plan['settings'])} != plan['private_files']:
        raise ValueError('The reviewed private configuration changed; no secrets are printed.')
    return plan


def stage(directory, expected_hash):
    if os.geteuid() != 0:
        raise PermissionError('Installing protected files requires administrator access.')
    directory = Path(directory).resolve(strict=True)
    protected_ancestry(directory)
    plan = read_plan(directory, expected_hash)
    for name in (*installation_files(plan['settings']), 'installation.json'):
        protected_ancestry(directory / name)
    if Path('/etc/machine-id').read_text().strip() != plan['host_machine_id']:
        raise ValueError('This installation is prepared only for the permanent Spark1 host.')
    settings = plan['settings']
    root = Path(settings['candidate'])
    # A writable parent could replace the protected release or base interpreter.
    runtime = verify(root)['runtime']
    base = Path(runtime['base_python'])
    for entry in (root, base): protected_ancestry(entry)
    for path in (*root.rglob('*'), *Path(runtime['base_root']).rglob('*')):
        if not path.is_symlink():
            info = path.stat()
            if info.st_uid != 0 or info.st_mode & 0o022:
                raise ValueError('Every sealed release file must be protected from runtime writes.')
    for path in config_files(settings):
        info = path.lstat()
        protected_ancestry(path.parent)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_gid != plan['gid']
                or stat.S_IMODE(info.st_mode) != 0o640):
            raise ValueError('Provision the reviewed root-owned private configuration and environment first.')
    home = Path(settings['home'])
    protected_ancestry(home.parent)
    state = Path(settings['state_root'])
    cache = Path(settings['model_cache'])
    for path in (home, state, cache):
        protected_ancestry(path.parent)
        if path.exists() or path.is_symlink():
            raise FileExistsError('First installation requires fresh reviewed runtime paths; preserve previous data.')
    for name in all_units(settings):
        target = Path('/etc/systemd/system') / name
        if target.exists() or target.is_symlink():
            raise FileExistsError('An existing system unit must be reviewed before replacement: ' + name)
    if 'service_ingress' in settings:
        from service_ingress import CONFIG, IMAGE
        target = Path(CONFIG)
        protected_ancestry(target.parent)
        if target.exists() or target.is_symlink():
            raise FileExistsError('Preserve the previous workload ingress configuration for review.')
        subprocess.run(['/usr/bin/docker', '--config', '/run/sparkie-install-docker-config',
                        '--host', 'unix:///var/run/docker.sock', 'image', 'inspect', IMAGE],
                       check=True, capture_output=True, timeout=15)
    # Refuse collisions and validate all inputs before creating the first file.
    directories = mutable_paths(settings)
    if settings.get('application_updates'):
        from upgrade_installation import stage as stage_updates
        stage_updates(root, plan['uid'], plan['gid'], home)
    subprocess.run(['/usr/bin/systemd-analyze', 'verify', *(str(directory / name) for name in all_units(settings))], check=True)
    prepare_home(home, uid=plan['uid'], gid=plan['gid'], configuration=directory / 'config.yaml',
                 soul=root / 'extension/SOUL.md', skills=root / 'extension/skills')
    for path in directories:
        path.mkdir(mode=0o700)
        os.chown(path, plan['uid'], plan['gid'])
    cache.mkdir(mode=0o700)
    os.chown(cache, plan['uid'], plan['gid'])
    # SGLang drops DAC capabilities and accesses this bind mount via the reviewed group.
    cache.chmod(0o770)
    for name in all_units(settings):
        target = Path('/etc/systemd/system') / name
        shutil.copyfile(directory / name, target)
        target.chmod(0o644)
    if 'service_ingress' in settings:
        from service_ingress import CONFIG
        shutil.copyfile(directory / 'service-ingress.Caddyfile', CONFIG)
        Path(CONFIG).chmod(0o644)
    subprocess.run(['/usr/bin/systemctl', 'daemon-reload'], check=True)
    print('Protected native policy, editable preferences and reviewed units staged. No service enabled or started; existing page and Telegram unchanged.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['render', 'stage'])
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--settings', type=Path)
    parser.add_argument('--plan-sha256')
    args = parser.parse_args()
    if args.action == 'render':
        if args.settings is None: parser.error('Render requires the concrete settings file.')
        print(render(json.loads(args.settings.read_text()), args.directory))
    else:
        if not args.plan_sha256: parser.error('Stage requires the reviewed plan SHA256.')
        stage(args.directory, args.plan_sha256)
