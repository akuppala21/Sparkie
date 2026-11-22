"""Fixed transport deadlines never extend a request or turn expiry into absence."""
import json
from threading import Thread
from types import SimpleNamespace
import pytest

from sparkie_sparks.io_budget import io_budget, remaining_io
from sparkie_sparks.power import PowerTransport
from test_power import HUB, NODE


def test_nested_budget_preserves_shorter_parent_and_does_not_leak_across_threads():
    now = [0]
    clock = lambda: now[0]
    seen = []
    with io_budget(10, clock=clock):
        now[0] = 6
        with io_budget(100, clock=clock):
            assert remaining_io(55) == 4
            thread = Thread(target=lambda: seen.append(remaining_io(55)))
            thread.start(); thread.join()
            now[0] = 10
            with pytest.raises(TimeoutError): remaining_io(1)
        with pytest.raises(TimeoutError): remaining_io(1)
    assert remaining_io(55) == 55 and seen == [55]


def test_fixed_ssh_timeout_is_remaining_budget_and_expiry_sends_no_request_or_false_tcp_absence():
    now, calls = [0], []
    def run(args, **kwargs):
        calls.append(kwargs['timeout'])
        return SimpleNamespace(returncode=0, stdout=json.dumps({'status':'observed',
            'hostname':NODE['hostname'],'machine_id':NODE['machine_id']}))
    transport = PowerTransport(runner=run, connect=lambda *a, **k: (_ for _ in ()).throw(AssertionError('No connection after expiry')))
    with io_budget(4, clock=lambda: now[0]):
        transport.request(NODE, HUB, 'inspect')
        now[0] = 4
        with pytest.raises(TimeoutError): transport.request(NODE, HUB, 'sleep')
        with pytest.raises(TimeoutError): transport.reachable(NODE)
    assert calls == [4]
