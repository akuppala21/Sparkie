"""Private relay identity and lifecycle, using inert SSH adapters and OS sockets."""
from contextlib import contextmanager
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace

import pytest

from sparkie_sparks.endpoint_relay import EndpointRelay

NODE = {'id': 'spark2', 'address': '192.0.2.2', 'user': 'owner'}
ENDPOINT = {'recipe': 'fixture-app', 'revision': 'a' * 64, 'spark': 'spark2',
            'instance': 'b' * 32, 'kind': 'app', 'host': NODE['address'], 'port': 32150,
            'backend_host': '127.0.0.1', 'ready': True, 'observed_at': 1000}


class Child:
    def __init__(self): self.code, self.stopped = None, 0
    def poll(self): return self.code
    def terminate(self): self.stopped += 1; self.code = 0
    def wait(self, **kwargs): return self.code
    def kill(self): self.code = -9


@pytest.fixture
def relay():
    with tempfile.TemporaryDirectory(prefix='er-', dir='/tmp') as directory:
        children, launches, reads, connects = [], [], [], []
        def popen(args, **kwargs):
            launches.append((args, kwargs))
            child = Child()
            children.append(child)
            return child
        def runner(args, **kwargs):
            reads.append(args)
            return SimpleNamespace(returncode=0)
        @contextmanager
        def connect(address, **kwargs):
            connects.append(address)
            yield
        service = EndpointRelay({'ports': {'fixture-app': 32250}, 'directory': directory},
            [NODE], popen=popen, runner=runner, connect=connect, clock=lambda: 1000)
        try:
            yield SimpleNamespace(service=service, children=children, launches=launches,
                                  reads=reads, connects=connects, directory=Path(directory))
        finally:
            service.close()


@pytest.mark.parametrize('change', [
    {'recipe': 'not-enrolled'}, {'spark': 'spark1'}, {'host': '192.0.2.3'},
    {'backend_host': '0.0.0.0'}, {'ready': False}, {'kind': 'shell'},
    {'instance': '../other'}, {'revision': 'a' * 63}, {'port': True}, {'port': 22},
    {'observed_at': 994}, {'observed_at': 1001}, {'observed_at': float('nan')},
    {'observed_at': True}, {'extra': 'unsupported'},
])
def test_relay_rejects_unverified_identity_or_destination_before_spawning(relay, change):
    with pytest.raises(ValueError): relay.service.ensure(ENDPOINT | change)
    assert relay.launches == [] and relay.reads == [] and relay.connects == []


def test_forward_is_loopback_only_strict_and_reused_by_exact_identity(relay):
    first = relay.service.ensure(ENDPOINT)
    assert first == {'port': 32250, 'kind': 'app', 'instance': 'b' * 32}
    assert relay.service.ensure(ENDPOINT) == first and len(relay.launches) == 1
    args, kwargs = relay.launches[0]
    assert args[:3] == ['ssh', '-N', '-T']
    assert all(value in args for value in ('StrictHostKeyChecking=yes', 'ForwardAgent=no',
                                         'BatchMode=yes', 'ExitOnForwardFailure=yes'))
    assert args[args.index('-L') + 1] == '127.0.0.1:32250:127.0.0.1:32150'
    assert args[-1] == 'owner@192.0.2.2' and kwargs['stdin'] == subprocess.DEVNULL
    assert relay.reads[0][3:5] == ['-O', 'check']
    assert relay.connects == [('127.0.0.1', 32250)]


def test_changed_instance_stops_only_owned_child_and_never_adopts_old_socket(relay):
    relay.service.ensure(ENDPOINT)
    first = relay.children[0]
    second = ENDPOINT | {'instance': 'c' * 32}
    assert relay.service.ensure(second)['instance'] == 'c' * 32
    assert first.stopped == 1 and len(relay.children) == 2
    relay.service.discard('fixture-app', 'b' * 32)
    assert relay.children[1].poll() is None
    relay.service.discard('fixture-app', 'c' * 32)
    assert relay.children[1].stopped == 1 and relay.service.children == {}
    (relay.directory / 'fixture-app').write_text('unrelated recovery record')
    with pytest.raises(RuntimeError, match='controller recovery'):
        relay.service.ensure(ENDPOINT)
    assert len(relay.children) == 2
    assert (relay.directory / 'fixture-app').read_text() == 'unrelated recovery record'


def test_prune_and_child_exit_do_not_release_or_mutate_any_workload(relay):
    relay.service.ensure(ENDPOINT)
    relay.service.prune(['b' * 32])
    assert relay.children[0].poll() is None
    relay.children[0].code = 255
    relay.service.ensure(ENDPOINT)
    assert len(relay.children) == 2
    relay.service.prune([])
    assert relay.children[1].stopped == 1 and relay.service.children == {}


def test_unrelated_listener_does_not_satisfy_missing_control_master(relay):
    clock = [0]
    relay.service.monotonic = lambda: clock[0]
    relay.service.sleep = lambda seconds: clock.__setitem__(0, clock[0] + 1)
    relay.service.runner = lambda *a, **k: SimpleNamespace(returncode=255)
    with pytest.raises(RuntimeError, match='did not become ready'):
        relay.service.ensure(ENDPOINT)
    assert relay.connects == [] and relay.children[0].stopped == 1
    assert relay.service.children == {}


def test_real_process_collision_cleanup_and_clean_controller_restart():
    # This is an OS-process/socket fixture, not an SSH server qualification.
    source = '''import os, signal, socket, sys, time
port, control = int(sys.argv[1]), sys.argv[2]
tcp = socket.socket()
tcp.bind(('127.0.0.1', port))
tcp.listen()
unix = socket.socket(socket.AF_UNIX)
unix.bind(control)
unix.listen()
def stop(*args):
    unix.close()
    tcp.close()
    os.unlink(control)
    raise SystemExit(0)
signal.signal(signal.SIGTERM, stop)
while True: time.sleep(.05)
'''
    with tempfile.TemporaryDirectory(prefix='ep-', dir='/tmp') as directory:
        launches = []
        def popen(args, **kwargs):
            forwarding = args[args.index('-L') + 1]
            port = forwarding.split(':')[1]
            control = args[args.index('-S') + 1]
            child = subprocess.Popen([sys.executable, '-c', source, port, control],
                                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            launches.append(child)
            return child
        def control(args, **kwargs):
            path = args[args.index('-S') + 1]
            return SimpleNamespace(returncode=0 if Path(path).is_socket() else 255)
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0)); listener.listen()
            port = listener.getsockname()[1]
            config = {'ports': {'fixture-app': port}, 'directory': directory}
            first = EndpointRelay(config, [NODE], popen=popen, runner=control, clock=lambda: 1000)
            with pytest.raises(RuntimeError): first.ensure(ENDPOINT)
            assert first.children == {} and all(p.poll() is not None for p in launches)
            # The unrelated listener remains under its original owner.
            with socket.create_connection(('127.0.0.1', port), timeout=1): pass
        try:
            assert first.ensure(ENDPOINT)['port'] == port
            original = launches[-1]
            restarted = EndpointRelay(config, [NODE], popen=popen, runner=control, clock=lambda: 1000)
            with pytest.raises(RuntimeError, match='controller recovery'): restarted.ensure(ENDPOINT)
            assert original.poll() is None
            first.close()
            assert original.poll() is not None and not (Path(directory) / 'fixture-app').exists()
            assert restarted.ensure(ENDPOINT)['port'] == port
            restarted.close()
            assert all(p.poll() is not None for p in launches)
        finally:
            first.close()
            for child in launches:
                if child.poll() is None: child.kill(); child.wait(timeout=3)
