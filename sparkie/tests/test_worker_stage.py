"""Fresh worker code/config ancestors must remain traversable under sudo umask."""
import importlib.util
import os
from pathlib import Path


def test_new_worker_directories_ignore_private_umask_without_changing_existing_parent(tmp_path):
    source = Path(__file__).resolve().parents[1] / 'deploy/worker_stage.py'
    spec = importlib.util.spec_from_file_location('worker_stage_under_test', source)
    worker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(worker)
    existing = tmp_path / 'existing'
    existing.mkdir(mode=0o700)
    previous = os.umask(0o077)
    try:
        worker.create_public_parents(existing / 'sparkie/worker' / worker.VERSION)
    finally:
        os.umask(previous)
    assert existing.stat().st_mode & 0o777 == 0o700
    for directory in (existing / 'sparkie', existing / 'sparkie/worker', existing / 'sparkie/worker' / worker.VERSION):
        assert directory.stat().st_mode & 0o777 == 0o755
