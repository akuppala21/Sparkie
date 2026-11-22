"""Prepare a fresh native home with protected policy and editable preferences.

Requires administrator identity and never operates on an existing home. The
sticky root-owned parent permits native SQLite/atomic state files while root-
owned scripts, profiles, plugins, identity and native managed policy cannot be
replaced by the runtime account. Normal native appearance settings stay writable.
"""
import argparse
import os
from pathlib import Path
import shutil
import stat

from managed_config import prepare as prepare_config, validate as validate_config

PROTECTED_DIRS = ('plugins', 'profiles', 'scripts')
MUTABLE_DIRS = ('cache', 'logs', 'cron', 'kanban', 'platforms', 'memory', 'memories',
                'sessions', 'backups', 'runtime', 'state', 'webapp', 'assets')
PROTECTED_FILES = ('SOUL.md', '.env', 'shell-hooks-allowlist.json')


def prepare(home, *, uid, gid, configuration, soul, skills):
    if os.geteuid() != 0:
        raise PermissionError('Preparing the protected native home requires administrator access.')
    if type(uid) is not int or uid <= 0 or type(gid) is not int or gid <= 0:
        raise ValueError('Use the non-root trusted application UID and group.')
    home = Path(home).absolute()
    if home.exists() or home.is_symlink():
        raise FileExistsError('Use a fresh native home; preserve previous assistant state.')
    home.mkdir(mode=0o1770)
    os.chown(home, 0, gid)
    home.chmod(0o1770)
    for name in PROTECTED_DIRS:
        path = home / name
        path.mkdir(mode=0o750)
        os.chown(path, 0, gid)
        path.chmod(0o750)
    for name in MUTABLE_DIRS:
        path = home / name
        path.mkdir(mode=0o700)
        os.chown(path, uid, gid)
    prepare_config(home, uid=uid, gid=gid, configuration=configuration)
    for name, source in (('SOUL.md', soul),):
        path = home / name
        shutil.copyfile(source, path)
        os.chown(path, 0, gid)
        path.chmod(0o640)
    environment = home / '.env'
    environment.touch(mode=0o640)
    os.chown(environment, 0, gid)
    environment.chmod(0o640)
    hook_approvals = home / 'shell-hooks-allowlist.json'
    hook_approvals.write_text('{"approvals": []}\n')
    os.chown(hook_approvals, 0, gid)
    hook_approvals.chmod(0o640)
    skill_root = home / 'skills'
    skill_root.mkdir(mode=0o1770)
    os.chown(skill_root, 0, gid)
    skill_root.chmod(0o1770)
    # The maintained research guidance is part of the reviewed candidate.
    # Other native learned skills remain writable beside this protected entry.
    for source in Path(skills).iterdir():
        if not source.is_dir() or source.is_symlink():
            raise ValueError('Packaged skills must be ordinary reviewed directories.')
        target = skill_root / source.name
        shutil.copytree(source, target)
        for path in (target, *target.rglob('*')):
            if path.is_symlink():
                raise ValueError('Packaged guidance cannot redirect outside the candidate.')
            os.chown(path, 0, gid)
            path.chmod(0o750 if path.is_dir() else 0o640)
    verify(home, gid=gid)


def verify(home, *, gid):
    home = Path(home)
    info = home.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_gid != gid or stat.S_IMODE(info.st_mode) != 0o1770:
        raise ValueError('The native home must have its root-owned sticky parent boundary.')
    for name in (*PROTECTED_DIRS, *PROTECTED_FILES):
        path = home / name
        info = path.lstat()
        expected = stat.S_ISDIR(info.st_mode) if name in PROTECTED_DIRS else stat.S_ISREG(info.st_mode)
        if not expected or info.st_uid != 0 or info.st_gid != gid or info.st_mode & 0o022:
            raise ValueError('A protected native entry has become writable or replaceable.')
    validate_config(home, check_native=False)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--home', type=Path, required=True)
    parser.add_argument('--uid', type=int, required=True)
    parser.add_argument('--gid', type=int, required=True)
    parser.add_argument('--configuration', type=Path, required=True)
    parser.add_argument('--soul', type=Path, required=True)
    parser.add_argument('--skills', type=Path, required=True)
    args = parser.parse_args()
    prepare(args.home, uid=args.uid, gid=args.gid, configuration=args.configuration,
            soul=args.soul, skills=args.skills)
    print('Prepared fresh protected native home; no service installed or started.')
