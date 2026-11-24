"""Administrator staging for the fixed compute worker; starts no service/job.

The existing authenticated SSH connection invokes the versioned zipapp only
when the checked Spark1 controller admits work. This installs no SSH server,
user, authorized key, firewall rule, daemon or privileged helper.
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
import tempfile

VERSION = '20261119-candidate3'
DESTINATION = Path('/opt/sparkie/worker') / VERSION
CONFIG = Path('/etc/sparkie/worker.json')
STATE = Path('/var/lib/sparkie/worker')


def digest(path):
    with Path(path).open('rb') as stream: return hashlib.file_digest(stream, 'sha256').hexdigest()


def create_public_parents(path):
    """Create only missing protected ancestors with explicit traversal modes."""
    missing = []
    current = Path(path)
    while not current.exists() and not current.is_symlink():
        missing.append(current)
        current = current.parent
    for directory in reversed(missing):
        directory.mkdir(mode=0o755)
        directory.chmod(0o755)


def check_interface(config, *, run=subprocess.run):
    """Catch an obsolete or mismatched private enrollment before installing it."""
    interface = config.get('interface')
    if not isinstance(interface, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,14}', interface) or interface == 'lo':
        raise ValueError('Set interface to the verified LAN device before staging this worker.')
    result = run(['/usr/sbin/ip', '-j', '-4', 'address', 'show', 'dev', interface],
                 capture_output=True, text=True, timeout=5, check=True)
    links = json.loads(result.stdout)
    if (len(links) != 1 or links[0].get('ifname') != interface or 'UP' not in links[0].get('flags', [])
            or links[0].get('operstate') not in ('UP', 'UNKNOWN')
            or not any(row.get('family') == 'inet' and row.get('scope') == 'global'
                       and row.get('local') == config['node']['host']
                       for row in links[0].get('addr_info', []))):
        raise ValueError('The enrolled private address is not active on this LAN interface.')


def stage(archive, configuration, *, archive_hash, config_hash, user):
    if os.geteuid() != 0: raise PermissionError('Protected worker staging needs the administrator.')
    archive_bytes, config_bytes = Path(archive).read_bytes(), Path(configuration).read_bytes()
    if (hashlib.sha256(archive_bytes).hexdigest() != archive_hash
            or hashlib.sha256(config_bytes).hexdigest() != config_hash):
        raise ValueError('The reviewed compute worker or private configuration changed.')
    account = pwd.getpwnam(user)
    if account.pw_uid == 0: raise ValueError('The worker must run as the trusted non-root application user.')
    config = json.loads(config_bytes)
    if (config['schema'] != 1 or config['node']['spark_id'] not in ('spark2', 'spark3', 'spark4')
            or config['node']['machine_id'] != Path('/etc/machine-id').read_text().strip()
            or config['node']['machine_id'] == config['hub_machine_id'] or Path(config['state_dir']) != STATE):
        raise ValueError('This worker configuration does not name this exact compute Spark.')
    check_interface(config)
    image = config['image_id']
    if not isinstance(image, str) or len(image) != 71 or not image.startswith('sha256:'):
        raise ValueError('Use the qualified sandbox image identity.')
    # Never let an operator Docker context redirect even this read-only check.
    with tempfile.TemporaryDirectory(prefix='sparkie-worker-image-') as private:
        result = subprocess.run(['/usr/bin/docker', '--config', private, '--host', 'unix:///var/run/docker.sock',
            'image', 'inspect', '--format', '{{.Id}}', image], capture_output=True, text=True, timeout=15,
            env={'PATH': '/usr/bin:/bin'})
    if result.returncode or result.stdout.strip() != image:
        raise ValueError('The qualified sandbox image must already be present on this compute Spark.')
    for target in (DESTINATION, CONFIG, STATE):
        if target.exists() or target.is_symlink():
            raise FileExistsError('Preserve existing workers/state; this command prepares only a fresh version.')
        for parent in target.parents:
            if parent.exists():
                info = parent.lstat()
                if (not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022
                        or not (info.st_mode & 0o001 or info.st_gid == account.pw_gid and info.st_mode & 0o010)):
                    raise ValueError('Worker code/config/state ancestors must be protected from replacement.')
    create_public_parents(DESTINATION)
    create_public_parents(CONFIG.parent)
    create_public_parents(STATE.parent)
    (DESTINATION / 'workspace-worker.pyz').write_bytes(archive_bytes)
    (DESTINATION / 'workspace-worker.pyz').chmod(0o644)
    CONFIG.write_bytes(config_bytes)
    os.chown(CONFIG, 0, account.pw_gid)
    CONFIG.chmod(0o640)
    STATE.mkdir(mode=0o700)
    os.chown(STATE, account.pw_uid, account.pw_gid)
    return {'staged': True, 'spark': config['node']['spark_id'], 'started_jobs': 0,
            'archive_sha256': digest(DESTINATION / 'workspace-worker.pyz')}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--configuration', type=Path, required=True)
    parser.add_argument('--archive-sha256', required=True)
    parser.add_argument('--configuration-sha256', required=True)
    parser.add_argument('--user', required=True)
    args = parser.parse_args()
    print(json.dumps(stage(args.archive, args.configuration, archive_hash=args.archive_sha256,
        config_hash=args.configuration_sha256, user=args.user)))
