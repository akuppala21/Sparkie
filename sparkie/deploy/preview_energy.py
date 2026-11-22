"""Inspect or back up the existing metering database as its runtime user."""

import argparse
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import stat
import sys
import tempfile


def _private_file(path, identity):
    info = path.lstat()
    if (not stat.S_ISREG(info.st_mode) or (info.st_uid, info.st_gid) != identity
            or stat.S_IMODE(info.st_mode) != 0o600):
        raise ValueError('Metering data needs an ordinary private runtime-owned file.')
    return info


def _summary(connection):
    connection.execute('PRAGMA trusted_schema=OFF')
    if (connection.execute('PRAGMA user_version').fetchone() != (2,)
            or connection.execute('PRAGMA quick_check').fetchall() != [('ok',)]):
        raise ValueError('The existing electricity database failed its schema or integrity check.')
    samples = {spark: {'count': count, 'latest': latest} for spark, count, latest in connection.execute(
        'SELECT spark, count(*), max(at) FROM readings GROUP BY spark')}
    history = connection.execute(
        'SELECT spark, month, kwh, covered_seconds, since, until, source_sha256 '
        'FROM monthly_history ORDER BY spark, month').fetchall()
    if not samples or not history:
        raise ValueError('The published electricity database needs its recorded samples and imported history.')
    return {'readings': sum(row['count'] for row in samples.values()), 'by_spark': samples,
            'monthly_totals': len(history), 'imported_kwh': sum(row[2] for row in history),
            'monthly_history_sha256': hashlib.sha256(json.dumps(history, separators=(',', ':')).encode()).hexdigest()}


def inspect(path, *, identity, archive=None):
    path = Path(path)
    if path.resolve(strict=True) != path:
        raise ValueError('The reviewed electricity path must not use symlinks.')
    parent = path.parent.lstat()
    if (not stat.S_ISDIR(parent.st_mode) or (parent.st_uid, parent.st_gid) != identity
            or parent.st_mode & 0o022 or not os.access(path.parent, os.W_OK | os.X_OK)):
        raise ValueError('The metering directory must allow only the runtime user to write SQLite sidecars.')
    original = _private_file(path, identity)
    for extension in ('-journal', '-wal', '-shm'):
        sidecar = path.with_name(path.name + extension)
        if sidecar.exists() or sidecar.is_symlink():
            _private_file(sidecar, identity)
    with closing(sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=5)) as source:
        if archive is None:
            summary = _summary(source)
        else:
            with tempfile.TemporaryDirectory(prefix='sparkie-meter-backup-') as temporary:
                snapshot = Path(temporary) / 'electricity.sqlite3'
                with closing(sqlite3.connect(snapshot)) as copy:
                    source.backup(copy)
                    summary = _summary(copy)
                with snapshot.open('rb') as stream:
                    shutil.copyfileobj(stream, archive)
    latest = _private_file(path, identity)
    if (latest.st_dev, latest.st_ino) != (original.st_dev, original.st_ino):
        raise ValueError('The electricity database was replaced during inspection.')
    return {**summary, 'database_identity': [latest.st_dev, latest.st_ino]}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('database', type=Path)
    parser.add_argument('uid', type=int)
    parser.add_argument('gid', type=int)
    parser.add_argument('--backup', action='store_true')
    args = parser.parse_args()
    identity = args.uid, args.gid
    if (os.geteuid(), os.getegid()) != identity or args.uid == 0:
        raise PermissionError('The metering inspection must run as the reviewed unprivileged runtime user.')
    summary = inspect(args.database, identity=identity, archive=sys.stdout.buffer if args.backup else None)
    print(json.dumps(summary), file=sys.stderr if args.backup else sys.stdout)
