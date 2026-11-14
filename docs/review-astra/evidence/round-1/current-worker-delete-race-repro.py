#!/usr/bin/env python3
"""Reproduce the current workspace delete race using an isolated temporary file.

No external commands are executed. Run with Python 3; optionally pass --portal-root.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
from unittest.mock import patch


def main():
    repo = Path(os.environ.get('SPARK_REVIEW_ROOT', str(Path(__file__).resolve().parents[4]))).resolve()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--portal-root', type=Path,
                        default=repo / 'service')
    parser.add_argument('--scope', default='current source; isolated temporary files only')
    args = parser.parse_args()
    source = args.portal_root / 'worker.py'
    spec = importlib.util.spec_from_file_location('review_worker', source)
    worker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(worker)
    with tempfile.TemporaryDirectory(prefix='spark-worker-review-') as directory:
        root = Path(directory)
        target = root / 'note.txt'
        target.write_bytes(b'old content')
        with patch.object(worker, 'WORKSPACE_ROOT', root), \
                patch.object(worker.subprocess, 'Popen', side_effect=AssertionError('No subprocesses permitted')):
            old = worker.workspace_files({'operation': 'read', 'path': 'note.txt'})
            original_stat = worker.os.stat
            stat_calls = 0
            concurrent_edit_written = False

            def interleaved_stat(path, *positional, **kwargs):
                nonlocal stat_calls, concurrent_edit_written
                if path == 'note.txt' and 'dir_fd' in kwargs:
                    stat_calls += 1
                    if stat_calls == 2:
                        # Simulate the full editor writing in place after the
                        # portal checked the original content hash.
                        target.write_bytes(b'new editor content')
                        concurrent_edit_written = True
                return original_stat(path, *positional, **kwargs)

            with patch.object(worker.os, 'stat', side_effect=interleaved_stat):
                result = worker.workspace_files({
                    'operation': 'delete', 'path': 'note.txt', 'revision': old['revision']})
            report = {
                'scope': args.scope,
                'source': str(source.resolve()),
                'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                'repro': 'concurrent in-place editor write during portal delete',
                'concurrent_edit_written': concurrent_edit_written,
                'worker_result': result,
                'file_still_exists': target.exists(),
                'bug_reproduced': concurrent_edit_written and result.get('deleted') is True and not target.exists(),
                'external_commands_executed': 0,
            }
            print(json.dumps(report, indent=2))
            assert report['bug_reproduced'], 'Expected delete race did not reproduce; inspect changed behavior.'


if __name__ == '__main__':
    main()
