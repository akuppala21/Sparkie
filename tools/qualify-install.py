#!/usr/bin/env python3
"""Verify the install source against lock.tree without writing a Git index or object.

A checkout is read through git ls-files. pull.sh supplies its source ls-tree manifest
for an archive with no .git; the manifest is checked by rebuilding the tree hash and
checking every unpacked file. Only the held-out evaluation file may be omitted.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys

LOCK = 'service/workflows.lock.json'
HELD = 'test/eval/memory-held-out.json'


def qualify(root, manifest=None, freeze=None, manifest_out=None):
    root = Path(root).resolve()
    if not manifest and Path(str(root) + '.manifest').is_file():
        manifest = str(root) + '.manifest'
    lock = json.loads((root / LOCK).read_text())
    tree = lock.get('tree', '')
    if not isinstance(tree, str) or not re.fullmatch(r'[0-9a-f]{40}([0-9a-f]{24})?', tree):
        raise ValueError('the test lock names no exact source tree; run the whole suite on this tree first')
    digest = hashlib.sha1 if len(tree) == 40 else hashlib.sha256

    def obj(kind, data):
        return digest(kind + b' %d\0' % len(data) + data).hexdigest()

    def entry(path):
        file = root / os.fsdecode(path)
        st = file.lstat()
        if stat.S_ISLNK(st.st_mode):
            return '120000', obj(b'blob', os.fsencode(os.readlink(file)))
        if not stat.S_ISREG(st.st_mode):
            raise ValueError('the source contains something other than a plain file or link: ' + os.fsdecode(path))
        return ('100755' if st.st_mode & stat.S_IXUSR else '100644'), obj(b'blob', file.read_bytes())

    want = {}
    # A real checkout is always read directly, regardless of an inherited manifest variable.
    git = subprocess.run(['git', '-C', str(root), 'rev-parse', '--show-toplevel'], capture_output=True, check=False) if shutil.which('git') else None
    checkout = git is not None and git.returncode == 0 and Path(os.fsdecode(git.stdout.strip())).resolve() == root
    if checkout:
        found = subprocess.run(['git', '-C', str(root), 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], capture_output=True, check=True)
        for path in found.stdout.split(b'\0'):
            if not path or path == LOCK.encode():
                continue
            try:
                want[path] = entry(path)
            except FileNotFoundError:
                pass  # git add -A also records a tracked deletion.
    elif manifest:
        for record in Path(manifest).read_bytes().split(b'\0'):
            if not record:
                continue
            meta, path = record.split(b'\t', 1)
            mode, kind, blob = meta.decode('ascii').split(' ')
            if mode not in ('100644', '100755', '120000') or kind != 'blob' or not re.fullmatch(r'[0-9a-f]{%d}' % len(tree), blob):
                raise ValueError('the source manifest contains an unsupported entry')
            if path in want or path.startswith(b'/') or any(p in (b'', b'.', b'..') for p in path.split(b'/')):
                raise ValueError('the source manifest contains an invalid or repeated path')
            if path != LOCK.encode():
                want[path] = (mode, blob)
        have = set()
        for folder, dirs, files in os.walk(root, followlinks=False):
            for name in dirs + files:
                file = Path(folder) / name
                if file.is_symlink() or not file.is_dir():
                    path = os.fsencode(str(file.relative_to(root)))
                    if path != LOCK.encode():
                        have.add(path)
        missing = set(want) - have
        if missing - {HELD.encode()} or have - set(want):
            raise ValueError('the archive file list differs from its tested tree')
        for path in have:
            if entry(path) != want[path]:
                raise ValueError('the archive differs from its tested tree: ' + os.fsdecode(path))

    else:
        # A complete source archive can prove its tree directly, with no Git installation.
        # pull.sh needs the manifest branch only because it deliberately omits the held-out file.
        for folder, dirs, files in os.walk(root, followlinks=False):
            for name in dirs + files:
                file = Path(folder) / name
                if file.is_symlink() or not file.is_dir():
                    path = os.fsencode(str(file.relative_to(root)))
                    if path != LOCK.encode():
                        want[path] = entry(path)

    folders = {}
    for path, leaf in want.items():
        parts = path.split(b'/')
        folder = folders
        for part in parts[:-1]:
            folder = folder.setdefault(part, {})
            if not isinstance(folder, dict):
                raise ValueError('the source manifest repeats a file as a folder')
        if parts[-1] in folder:
            raise ValueError('the source manifest repeats a path')
        folder[parts[-1]] = leaf

    def folder_hash(folder):
        data = b''
        for name, value in sorted(folder.items(), key=lambda item: item[0] + (b'/' if isinstance(item[1], dict) else b'\0')):
            mode, blob = ('40000', folder_hash(value)) if isinstance(value, dict) else value
            data += mode.encode() + b' ' + name + b'\0' + bytes.fromhex(blob)
        return obj(b'tree', data)

    actual = folder_hash(folders)
    if actual != tree:
        raise ValueError('the test lock is for tree %s, but this source is tree %s; run the whole suite on this tree first' % (tree[:12], actual[:12]))
    if freeze:
        target = Path(freeze).resolve()
        if target == root or root in target.parents:
            raise ValueError('the frozen source must be outside the input tree')
        target.mkdir()
        proof = Path(manifest_out or str(target) + '.manifest')
        proof.write_bytes(b''.join(mode.encode() + b' blob ' + blob.encode() + b'\t' + path + b'\0' for path, (mode, blob) in sorted(want.items())))
        for path, (mode, blob) in want.items():
            if path == HELD.encode():
                continue  # This file never reaches the hub, even in the retained source.
            source, dest = root / os.fsdecode(path), target / os.fsdecode(path)
            dest.parent.mkdir(parents=True, exist_ok=True)
            if mode == '120000':
                dest.symlink_to(os.readlink(source))
            else:
                dest.write_bytes(source.read_bytes())
                dest.chmod(0o755 if mode == '100755' else 0o644)
        (target / LOCK).write_bytes((root / LOCK).read_bytes())
        # Qualify what was copied, so concurrent edits cannot slip into shipped artifacts.
        qualify(target, str(proof))
    return actual


if __name__ == '__main__':
    try:
        parser = argparse.ArgumentParser(description=__doc__)
        parser.add_argument('root')
        parser.add_argument('--freeze')
        parser.add_argument('--manifest-out')
        args = parser.parse_args()
        print(qualify(args.root, os.environ.get('SPARK_INSTALL_MANIFEST'), args.freeze, args.manifest_out))
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print('Stopped: %s. Nothing was installed.' % error, file=sys.stderr)
        sys.exit(1)
