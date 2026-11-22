"""Stage a reviewed service worker without changing an SSH login, launching a workload or replacing state."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import stat
import tempfile

from worker_stage import create_public_parents

STATE = Path('/var/lib/sparkie/services')
ARTIFACTS = Path('/var/lib/sparkie/service-artifacts')
WORKERS = Path('/opt/sparkie/worker/services')
SETTINGS = Path('/etc/sparkie/services')


def checked_parent(path, group):
    for parent in path.parents:
        if not parent.exists() and not parent.is_symlink():
            continue
        status = parent.lstat()
        if (
            not stat.S_ISDIR(status.st_mode)
            or status.st_uid != 0
            or status.st_mode & 0o022
            or not (status.st_mode & 0o001 or status.st_gid == group and status.st_mode & 0o010)
        ):
            raise ValueError('Protected worker ancestors must be administrator-owned and traversable.')


def install_file(path, contents, mode, group):
    if path.exists() or path.is_symlink():
        status = path.lstat()
        if (
            not stat.S_ISREG(status.st_mode)
            or status.st_uid != 0
            or status.st_gid != group
            or stat.S_IMODE(status.st_mode) != mode
            or path.read_bytes() != contents
        ):
            raise ValueError('The existing sealed worker file differs; preserve it for recovery.')
        return
    create_public_parents(path.parent)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=True) as tmp:
        tmp.write(contents)
        tmp.flush()
        os.fchmod(tmp.fileno(), mode)
        os.fchown(tmp.fileno(), 0, group)
        os.fsync(tmp.fileno())
        os.link(tmp.name, path)


def stage(archive, configuration, *, archive_hash, config_hash, user):
    if os.geteuid() != 0:
        raise PermissionError('A reviewed live worker staging action needs administrator authorization.')
    if any(not re.fullmatch('[0-9a-f]{64}', value) for value in (archive_hash, config_hash)):
        raise ValueError('Use the exact reviewed SHA-256 identities.')
    contents = Path(archive).read_bytes()
    config_data = Path(configuration).read_bytes()
    if (
        hashlib.sha256(contents).hexdigest() != archive_hash
        or hashlib.sha256(config_data).hexdigest() != config_hash
    ):
        raise ValueError('The reviewed worker inputs changed.')
    config = json.loads(config_data)
    account = pwd.getpwnam(user)
    if (
        account.pw_uid != 1000
        or set(config) != {'schema', 'controller', 'spark', 'machine', 'hub_machine', 'state_dir', 'data'}
        or config['schema'] != 1
        or config['spark'] not in ('spark2', 'spark3', 'spark4')
        or config['machine'] != Path('/etc/machine-id').read_text().strip()
        or config['machine'] == config['hub_machine']
        or not re.fullmatch('[0-9a-f]{32}', config['controller'])
        or not re.fullmatch('[0-9a-f]{32}', config['hub_machine'])
        or Path(config['state_dir']) != STATE
        or not isinstance(config['data'], dict)
        or not config['data']
        or not set(config['data']) <= {'artifact-browser', 'glm-flash'}
    ):
        raise ValueError(
            'Use this exact enrolled compute worker, state directory and protected recipe manifest.'
        )
    for name, item in config['data'].items():
        path = Path(item)
        if name == 'artifact-browser' and path == ARTIFACTS and not path.exists() and not path.is_symlink():
            continue
        if not path.is_absolute() or path.resolve() != path or not path.is_dir():
            raise ValueError('The enrolled artifact or weights directory must already exist.')
    runner = WORKERS / archive_hash / 'worker.pyz'
    settings = SETTINGS / config_hash / 'worker.json'
    for path in (runner, settings, STATE, ARTIFACTS):
        checked_parent(path, account.pw_gid)
    if STATE.exists() or STATE.is_symlink():
        status = STATE.lstat()
        if (
            not stat.S_ISDIR(status.st_mode)
            or stat.S_IMODE(status.st_mode) != 0o700
            or status.st_uid != account.pw_uid
        ):
            raise ValueError('Preserve existing service state; its identity or permissions changed.')
    else:
        create_public_parents(STATE.parent)
        STATE.mkdir(mode=0o700)
        os.chown(STATE, account.pw_uid, account.pw_gid)
    if config['data'].get('artifact-browser') == str(ARTIFACTS) and not ARTIFACTS.exists():
        ARTIFACTS.mkdir(mode=0o700)
        os.chown(ARTIFACTS, account.pw_uid, account.pw_gid)
    install_file(runner, contents, 0o644, 0)
    install_file(settings, config_data, 0o640, account.pw_gid)
    return {
        'spark': config['spark'],
        'executable': str(runner),
        'config': str(settings),
        'archive_sha256': archive_hash,
        'config_sha256': config_hash,
        'started_jobs': 0,
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', required=True)
    parser.add_argument('--configuration', required=True)
    parser.add_argument('--archive-sha256', required=True)
    parser.add_argument('--configuration-sha256', required=True)
    parser.add_argument('--user', required=True)
    args = parser.parse_args()
    print(
        json.dumps(
            stage(
                args.archive,
                args.configuration,
                archive_hash=args.archive_sha256,
                config_hash=args.configuration_sha256,
                user=args.user,
            )
        )
    )
