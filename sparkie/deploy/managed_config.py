"""Use native Hermes managed policy beside its writable preference config.

This module prepares files or checks them before startup. It implements no
config backend, settings route, agent loop or runtime policy watcher.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import stat

# Actual reviewed local-inference, access and execution settings. Ordinary
# display/memory preferences remain native user config, not an upstream-default freeze.
POLICY_ROOTS = ('model', 'fallback_providers', 'providers', 'toolsets', 'platform_toolsets',
    'agent', 'plugins', 'auxiliary', 'delegation', 'skills', 'browser', 'bot_desktop',
    'stt', 'web', 'file_tools', 'terminal', 'telemetry', 'webapp')
PREFERENCE_PATHS = (
    ('dashboard', 'theme'), ('dashboard', 'font'), ('dashboard', 'show_token_analytics'),
    ('display', 'skin'), ('display', 'language'), ('display', 'tui_theme'),
    ('display', 'show_reasoning'), ('display', 'show_commentary'), ('display', 'tool_progress'),
    ('display', 'interim_assistant_messages'), ('display', 'friendly_tool_labels'),
    ('display', 'turn_summary'), ('display', 'vim_mode'), ('display', 'tui_status_indicator'),
)


def split(configuration):
    """Keep exact reviewed policy in the supported administrator overlay."""
    if not isinstance(configuration, dict):
        raise ValueError('Native configuration must be a mapping.')
    preferences = copy.deepcopy(configuration)
    policy = {key: preferences.pop(key) for key in POLICY_ROOTS if key in preferences}
    memory = preferences.setdefault('memory', {})
    policy['memory'] = {'write_approval': True}
    memory.pop('write_approval', None)
    if 'provider' in memory:
        policy['memory']['provider'] = memory.pop('provider')
    # No approved host shell commands are carried into the fresh assistant.
    policy['hooks_auto_accept'] = False
    preferences.pop('hooks_auto_accept', None)
    return policy, preferences


def _yaml():
    from ruamel.yaml import YAML
    return YAML(typ='safe')


def _owned_write(path, contents, *, uid, gid, mode):
    with Path(path).open('x') as stream:
        stream.write(contents)
    os.chown(path, uid, gid)
    Path(path).chmod(mode)


def prepare(home, *, uid, gid, configuration):
    """Root prepares an immutable native overlay and writable user layer once."""
    from io import StringIO
    if os.geteuid() != 0:
        raise PermissionError('Preparing native managed configuration requires the administrator.')
    home = Path(home)
    policy, preferences = split(_yaml().load(Path(configuration)))
    directory = home / 'managed'
    directory.mkdir(mode=0o750)
    os.chown(directory, 0, gid)
    directory.chmod(0o750)
    for destination, value, owner in ((directory / 'config.yaml', policy, 0),
                                     (home / 'config.yaml', preferences, uid)):
        text = StringIO()
        _yaml().dump(value, text)
        _owned_write(destination, text.getvalue(), uid=owner, gid=gid, mode=0o640 if owner == 0 else 0o600)
    stamp = {'schema': 1, 'uid': uid, 'gid': gid,
             'config_sha256': hashlib.sha256((directory / 'config.yaml').read_bytes()).hexdigest()}
    _owned_write(directory / 'manifest.json', json.dumps(stamp, indent=2) + '\n', uid=0, gid=gid, mode=0o640)
    return stamp


def validate(home, *, check_native=True):
    """Fail closed before native startup if the reviewed overlay is unavailable."""
    home = Path(home).absolute()
    directory = home / 'managed'
    for path, is_directory in ((directory, True), (directory / 'manifest.json', False),
                               (directory / 'config.yaml', False)):
        info = path.lstat()
        expected = stat.S_ISDIR(info.st_mode) if is_directory else stat.S_ISREG(info.st_mode)
        if not expected or info.st_uid != 0 or info.st_mode & 0o022:
            raise ValueError('The native policy must remain root-owned and non-writable.')
    stamp = json.loads((directory / 'manifest.json').read_text())
    if stamp.get('schema') != 1 or type(stamp.get('uid')) is not int or stamp['uid'] <= 0:
        raise ValueError('The native policy manifest is invalid.')
    parent = home.lstat()
    if (not stat.S_ISDIR(parent.st_mode) or parent.st_uid != 0 or parent.st_gid != stamp['gid']
            or stat.S_IMODE(parent.st_mode) != 0o1770):
        raise ValueError('The native home must retain its protected sticky parent.')
    for path in home.parents:
        info = path.lstat()
        if (not stat.S_ISDIR(info.st_mode) or info.st_uid != 0
                or info.st_mode & 0o022):
            raise ValueError('The native policy ancestry is replaceable.')
    raw = (directory / 'config.yaml').read_bytes()
    if hashlib.sha256(raw).hexdigest() != stamp['config_sha256']:
        raise ValueError('The reviewed native policy changed.')
    policy = _yaml().load(raw)
    if not isinstance(policy, dict) or not policy:
        raise ValueError('The native policy is empty or invalid.')
    user = (home / 'config.yaml').lstat()
    if (not stat.S_ISREG(user.st_mode) or user.st_uid != stamp['uid']
            or stat.S_IMODE(user.st_mode) != 0o600):
        raise ValueError('Native user preferences need their private runtime-owned file.')
    if check_native:
        if (os.environ.get('HERMES_MANAGED_DIR') != str(directory)
                or os.environ.get('HERMES_CONFIG_BACKEND') != 'file'):
            raise ValueError('Launch native Hermes with this exact managed scope and file backend.')
        from hermes_cli import managed_scope
        if managed_scope.get_managed_dir() != directory or managed_scope.load_managed_config(strict=True) != policy:
            raise ValueError('Native Hermes did not load the reviewed managed policy.')
    return stamp


def import_preferences(source_home, destination_home, uid, gid):
    """Import only nonsecret native appearance from an archived, paused UI home.

    The promotion coordinator snapshots the source after stopping that UI and
    calls this before starting the replacement. Never import its model/access
    config, credentials, plugin code, scripts, conversations or memory.
    """
    from io import StringIO
    if uid <= 0 or (os.geteuid(), os.getegid()) != (uid, gid):
        raise PermissionError('Appearance import must use the reviewed unprivileged runtime identity.')
    home, source = Path(destination_home), Path(source_home)
    stamp = validate(home, check_native=False)
    if (stamp['uid'], stamp['gid']) != (uid, gid):
        raise ValueError('The destination native home belongs to a different runtime identity.')
    original = source / 'config.yaml'
    if original.is_symlink() or not original.is_file():
        raise ValueError('The preference snapshot needs an ordinary native config file.')
    incoming = _yaml().load(original)
    current = _yaml().load(home / 'config.yaml') or {}
    if not isinstance(incoming, dict):
        raise ValueError('The preference snapshot config is invalid.')
    names = []
    for section, key in PREFERENCE_PATHS:
        value = incoming.get(section, {}).get(key)
        if value is None:
            continue
        if type(value) not in (str, bool, int, float) or (isinstance(value, str) and len(value) > 256):
            raise ValueError('An appearance preference is not a bounded scalar.')
        current.setdefault(section, {})[key] = value
        names.append(section + '.' + key)
    # Validate every source asset before changing the fresh target preferences.
    themes = []
    theme_root = source / 'dashboard-themes'
    if theme_root.is_symlink():
        raise ValueError('Native theme snapshots cannot be symlinks.')
    if theme_root.is_dir():
        from hermes_cli.web_server_dashboard import _normalise_theme_definition
        for path in sorted(theme_root.glob('*.yaml')):
            if path.is_symlink() or path.stat().st_size > 1048576:
                raise ValueError('A native theme snapshot is invalid or too large.')
            raw = path.read_bytes()
            if _normalise_theme_definition(_yaml().load(raw)) is None:
                raise ValueError('A native theme snapshot is invalid.')
            themes.append((path.name, raw))
        if len(themes) > 128:
            raise ValueError('Too many native themes for this bounded import.')
    ui = source / 'ui-preferences.json'
    ui_values = None
    if ui.exists():
        if ui.is_symlink() or ui.stat().st_size > 3 * 1024 * 1024:
            raise ValueError('The native UI preference snapshot is invalid.')
        from hermes_cli.ui_preferences import read_preferences, _validate
        snapshot = read_preferences(ui)
        if not snapshot['exists']:
            raise ValueError('The native UI preference snapshot is unreadable.')
        ui_values = snapshot['values']
        _validate(ui_values)
    target = home / 'dashboard-themes'
    if target.is_symlink() or (target.exists() and not target.is_dir()):
        raise ValueError('The destination native themes directory is invalid.')
    if any((target / name).exists() or (target / name).is_symlink() for name, _ in themes):
        raise FileExistsError('Preserve existing native themes; import only into the fresh home.')
    text = StringIO()
    _yaml().dump(current, text)
    temporary = home / 'config.preference-import.yaml'
    with temporary.open('x') as stream:
        os.fchmod(stream.fileno(), 0o600)
        stream.write(text.getvalue())
    os.replace(temporary, home / 'config.yaml')
    if themes:
        if not target.exists():
            target.mkdir(mode=0o700)
        for name, raw in themes:
            destination = target / name
            with destination.open('xb') as stream:
                os.fchmod(stream.fileno(), 0o600)
                stream.write(raw)
    if ui_values is not None:
        from hermes_cli.ui_preferences import write_preferences
        write_preferences(ui_values, path=home / 'ui-preferences.json')
    return {'imported_config_keys': names, 'native_themes': len(themes), 'native_ui_preferences': ui_values is not None,
            'policy_changed': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--home', required=True, type=Path)
    parser.add_argument('--import-preview', type=Path)
    parser.add_argument('--runtime-uid', type=int)
    parser.add_argument('--runtime-gid', type=int)
    args = parser.parse_args()
    if args.import_preview is not None:
        if args.runtime_uid is None or args.runtime_gid is None:
            parser.error('Import requires the reviewed runtime user and group.')
        os.umask(0o077)
        print(json.dumps(import_preferences(args.import_preview, args.home, args.runtime_uid, args.runtime_gid)))
    else:
        validate(args.home)
        print('Native managed policy verified; owner appearance preferences remain editable.')
