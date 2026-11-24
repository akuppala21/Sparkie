"""Fresh worker code/config ancestors must remain traversable under sudo umask."""
import importlib.util
import json
import os
from pathlib import Path
from types import SimpleNamespace

import pytest


def staged_worker():
    source = Path(__file__).resolve().parents[1] / 'deploy/worker_stage.py'
    spec = importlib.util.spec_from_file_location('worker_stage_under_test', source)
    worker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(worker)
    return worker


def test_new_worker_directories_ignore_private_umask_without_changing_existing_parent(tmp_path):
    worker = staged_worker()
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


def test_installation_checks_the_enrolled_interface_before_accepting_a_worker():
    worker = staged_worker()
    address = '10.23.0.24'
    config = {'interface': 'enp2s0', 'node': {'host': address}}
    def run(argv, **kwargs):
        assert argv == ['/usr/sbin/ip', '-j', '-4', 'address', 'show', 'dev', 'enp2s0']
        return SimpleNamespace(stdout=json.dumps([{'ifname': 'enp2s0', 'flags': ['UP'],
            'operstate': 'UP', 'addr_info': [{'family': 'inet', 'scope': 'global', 'local': address}]}]))
    worker.check_interface(config, run=run)
    with pytest.raises(ValueError, match='before staging'):
        worker.check_interface({'node': config['node']}, run=run)
    with pytest.raises(ValueError, match='not active'):
        worker.check_interface({**config, 'node': {'host': '10.23.0.99'}}, run=run)
