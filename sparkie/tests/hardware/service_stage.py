"""Disposable container staging proof. Run only with no host Docker socket or writable host mounts."""

import hashlib
import sys
import json
import os
from pathlib import Path
import pwd
import tempfile
import zipfile

if not Path('/.dockerenv').is_file() or Path('/var/run/docker.sock').exists() or os.geteuid() != 0:
    raise SystemExit('Use the isolated staging container with its own root filesystem.')
deploy = Path(__file__).resolve().parents[2] / 'deploy'
sys.path.insert(0, str(deploy))
from service_worker_stage import ARTIFACTS, stage

try:
    account = pwd.getpwuid(1000)
except KeyError:
    # The pinned minimal image omits account utilities. Provision only this
    # throwaway container's passwd entry, without granting a usable login.
    with Path('/etc/passwd').open('a') as stream:
        stream.write('fixtureworker:x:1000:1000:Staging fixture:/nonexistent:/bin/false\n')
    account = pwd.getpwuid(1000)
machine = Path('/etc/machine-id')
if not machine.exists() or not machine.read_text().strip():
    machine.write_text('4' * 32 + '\n')
with tempfile.TemporaryDirectory() as directory:
    work = Path(directory)
    archive = work / 'worker.pyz'
    with zipfile.ZipFile(archive, 'w') as out:
        out.writestr('__main__.py', 'print("fixture")')
    config = {
        'schema': 1,
        'controller': '0' * 32,
        'spark': 'spark4',
        'hub_machine': '1' * 32,
        'machine': machine.read_text().strip(),
        'state_dir': '/var/lib/sparkie/services',
        'data': {'artifact-browser': str(ARTIFACTS)},
    }
    path = work / 'worker.json'
    path.write_text(json.dumps(config))
    digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()

    def install():
        return stage(
            archive, path, archive_hash=digest(archive), config_hash=digest(path), user=account.pw_name
        )

    first = install()
    marker = ARTIFACTS / 'preserved.txt'
    marker.write_text('preserve me')
    second = install()
    assert first == second and marker.read_text() == 'preserve me'
    exe, conf = Path(first['executable']), Path(first['config'])
    assert (
        exe.stat().st_uid == 0
        and exe.stat().st_mode & 0o777 == 0o644
        and conf.stat().st_mode & 0o777 == 0o640
    )
    assert ARTIFACTS.stat().st_uid == 1000 and Path(config['state_dir']).stat().st_uid == 1000
    exe.write_text('changed fixture')
    try:
        install()
    except ValueError:
        pass
    else:
        raise AssertionError('Changed sealed worker was accepted')
    print(
        json.dumps(
            {
                'passed': True,
                'stage_repeat_preserved_data': True,
                'protected_mode_verified': True,
                'changed_executable_rejected': True,
                'started_jobs': first['started_jobs'],
            }
        )
    )
