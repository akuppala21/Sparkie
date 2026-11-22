from contextlib import contextmanager
from dataclasses import asdict
import json
import os
import socket
import stat
import subprocess
import sys
import time
from threading import Thread

import pytest

from sparkie_sparks.authority import Owner, OwnerBinding
from sparkie_sparks.broker import FleetServer, RemoteControls, dispatch_request, private_json
from sparkie_sparks.controls import Controls
from sparkie_sparks.operations import OperationStore

BINDING = OwnerBinding('generation-1', 'owner', 'basic', '', 12345, 12345)
OWNER = Owner('generation-1', 'web')


@contextmanager
def serve(tmp_path, *, uid=None):
    events, outcomes, binding = [], ['succeeded'], [BINDING]
    service = Controls(OperationStore(tmp_path / 'operations.sqlite'), binding=lambda: binding[0],
        dispatch=lambda *args: events.append(args), observe=lambda *args: outcomes[0], actions=('stop_workload',))
    path = tmp_path / 'private/fleet.sock'
    with FleetServer(path, service, gateway_uid=os.geteuid() if uid is None else uid) as server:
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield RemoteControls(path), service, events, outcomes, binding, path
        finally:
            server.shutdown()
            thread.join(2)


def test_separate_native_clients_share_one_operation_and_exact_confirmation(tmp_path):
    with serve(tmp_path) as (web, service, events, outcomes, binding, path):
        telegram = RemoteControls(path)
        assert stat.S_IMODE(path.stat().st_mode) == 0o600
        assert web.binding() == BINDING
        assert web.capabilities(OWNER)['actions'] == ['stop_workload']
        with pytest.raises(ValueError):
            web.prepare(OWNER, request_key='wrong', request_ref='web:wrong', action='sleep', spark='spark2')
        row = web.prepare(OWNER, request_key='web:1', request_ref='web:1', action='stop_workload', spark='spark2', container='a' * 64)
        assert events == []
        assert telegram.get(OWNER, row['id'])['digest'] == row['digest']
        tg_owner = Owner('generation-1', 'telegram')
        telegram.store.bind_telegram_card(tg_owner, row['id'], chat=12345, message=7)
        telegram.store.require_telegram_card(tg_owner, row['id'], chat=12345, message=7)
        with pytest.raises(PermissionError):
            telegram.store.require_telegram_card(tg_owner, row['id'], chat=12345, message=8)
        assert telegram.confirm(tg_owner, row['id'], row['digest'])['state'] == 'succeeded'
        with pytest.raises(PermissionError):
            web.confirm(OWNER, row['id'], row['digest'])
        assert len(events) == 1
    assert not path.exists()


def test_actual_linux_peer_identity_is_checked_before_any_owner_data_is_read(tmp_path):
    with serve(tmp_path, uid=os.geteuid() + 1) as (remote, service, events, *rest):
        with pytest.raises(PermissionError):
            remote.binding()
        assert events == []


def test_revocation_and_uncertain_results_cross_the_private_connection_without_resends(tmp_path):
    with serve(tmp_path) as (remote, service, events, outcomes, binding, path):
        row = remote.prepare(OWNER, request_key='1', request_ref='fixture:1', action='stop_workload', spark='spark2', container='a' * 64)
        outcomes[0] = 'unknown'
        assert remote.confirm(OWNER, row['id'], row['digest'])['state'] == 'uncertain'
        assert remote.cancel(OWNER, row['id'])['cancel_requested']
        binding[0] = OwnerBinding('generation-2', 'owner', 'basic', '', 12345, 12345)
        with pytest.raises(PermissionError):
            remote.check(OWNER, row['id'])
        assert len(events) == 1
        binding[0] = BINDING
        outcomes[0] = 'succeeded'
        assert remote.check(OWNER, row['id'])['state'] == 'succeeded'
        assert len(events) == 1


def test_private_boundary_has_no_arbitrary_dispatch_command_or_identity_update(tmp_path):
    with serve(tmp_path) as (remote, service, events, *rest):
        for method in ('dispatch', 'shell', 'update_owner', '__dict__'):
            with pytest.raises(ValueError):
                dispatch_request(service, {'method': method, 'owner': None, 'params': {}})
        with pytest.raises(PermissionError):
            dispatch_request(service, {'method': 'recent', 'owner': {'generation': BINDING.generation, 'channel': 'agent'}, 'params': {}})
        assert events == []


def test_startup_refuses_live_socket_but_recovers_an_owned_stale_socket(tmp_path):
    with serve(tmp_path) as (remote, service, events, outcomes, binding, path):
        with pytest.raises(BlockingIOError):
            FleetServer(path, service, gateway_uid=os.geteuid())
        assert remote.binding() == BINDING
    with socket.socket(socket.AF_UNIX) as stale:
        stale.bind(str(path))
    with FleetServer(path, service, gateway_uid=os.geteuid()):
        assert path.exists()
    assert not path.exists()


def test_operator_config_must_be_private_and_cannot_be_a_symlink(tmp_path):
    path = tmp_path / 'private.json'
    path.write_text(json.dumps({'schema': 1}))
    path.chmod(0o600)
    assert private_json(path) == {'schema': 1}
    path.chmod(0o644)
    with pytest.raises(ValueError): private_json(path)
    path.chmod(0o600)
    link = tmp_path / 'link.json'
    link.symlink_to(path)
    with pytest.raises(OSError): private_json(link)


@pytest.mark.parametrize('uid,gid,permissions,allowed', [
    (0, 1234, 0o640, True), (1234, 1234, 0o640, False),
    (0, 2222, 0o640, False), (0, 1234, 0o660, False),
    (0, 1234, 0o644, False), (0, 1234, 0o750, False),
])
def test_only_root_primary_group_read_configuration_is_accepted(tmp_path, monkeypatch, uid, gid, permissions, allowed):
    from types import SimpleNamespace
    import sparkie_sparks.broker as broker
    path = tmp_path / 'authority.json'
    path.write_text('{"schema":1}')
    monkeypatch.setattr(broker.os, 'getegid', lambda: 1234)
    monkeypatch.setattr(broker.os, 'geteuid', lambda: 1234)
    monkeypatch.setattr(broker.os, 'fstat', lambda fd: SimpleNamespace(
        st_uid=uid, st_gid=gid, st_mode=stat.S_IFREG | permissions))
    if allowed:
        assert private_json(path) == {'schema': 1}
    else:
        with pytest.raises(ValueError): private_json(path)


def test_real_broker_process_stops_cleanly_and_retains_pending_requests_after_restart(tmp_path):
    paths = {name: tmp_path / (name + '.json') for name in ('binding', 'inventory', 'config')}
    paths['binding'].write_text(json.dumps(asdict(BINDING)))
    paths['inventory'].write_text(json.dumps({'schema': 1, 'nodes': [{'id': 'spark2', 'hostname': 'compute-fixture',
                                                                   'address': '192.0.2.2', 'user': 'owner'}]}))
    path = tmp_path / 'private/fleet.sock'
    paths['config'].write_text(json.dumps({'schema': 1, 'owner_binding': str(paths['binding']),
        'inventory': str(paths['inventory']), 'operations': str(tmp_path / 'operations.sqlite'),
        'socket': str(path), 'gateway_uid': os.geteuid()}))
    for item in paths.values(): item.chmod(0o600)
    row = None
    for _ in range(2):
        process = subprocess.Popen([sys.executable, '-m', 'sparkie_sparks.broker', '--config', str(paths['config'])],
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            deadline = time.monotonic() + 10
            while not path.exists():
                assert process.poll() is None, process.communicate()
                assert time.monotonic() < deadline, 'Private broker did not start'
                time.sleep(.02)
            remote = RemoteControls(path)
            if row is None:
                row = remote.prepare(OWNER, request_key='restart', request_ref='fixture:restart', action='stop_workload',
                                     spark='spark2', container='a' * 64)
                assert row['state'] == 'pending'
            else:
                assert remote.get(OWNER, row['id']) == row
        finally:
            process.terminate()
            process.communicate(timeout=5)
        assert process.returncode == 0 and not path.exists()


@contextmanager
def reply_once(tmp_path, response):
    """An incompatible local peer; exercise the actual client socket read."""
    path = tmp_path / 'reply.sock'
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as server:
        server.bind(str(path))
        server.listen(1)
        server.settimeout(3)
        failures = []
        def reply():
            try:
                connection, _ = server.accept()
                with connection:
                    connection.settimeout(3)
                    with connection.makefile('rb') as stream:
                        assert stream.readline(32769).endswith(b'\n')
                    connection.sendall(json.dumps(response).encode() + b'\n')
            except Exception as exc:
                failures.append(exc)
        thread = Thread(target=reply, daemon=True)
        thread.start()
        try:
            yield RemoteControls(path)
        finally:
            thread.join(4)
            assert not thread.is_alive() and not failures, failures


@pytest.mark.parametrize('response', [
    None, [], {}, {'result': None}, {'result': []},
    {'error': []}, {'error': 'permission'}, {'error': [], 'message': 'bad'},
    {'error': 'other', 'message': 'bad'}, {'error': 'permission', 'message': None},
    {'error': 'permission', 'message': 'x' * 513},
    {'result': {}, 'error': 'permission', 'message': 'bad'},
])
def test_malformed_json_replies_become_plain_unavailable_results(tmp_path, response):
    with reply_once(tmp_path, response) as remote:
        with pytest.raises(RuntimeError, match='private fleet connection is unavailable'):
            remote._call('binding')


@pytest.mark.parametrize('method,response', [('recent', {'result': {}}), ('bind_card', {'result': {}})])
def test_reply_type_matches_the_requested_operation(tmp_path, method, response):
    with reply_once(tmp_path, response) as remote:
        with pytest.raises(RuntimeError, match='private fleet connection is unavailable'):
            remote._call(method, OWNER)


@pytest.mark.parametrize('kind,exception', [('permission', PermissionError), ('invalid', ValueError), ('unavailable', RuntimeError)])
def test_peer_error_text_is_never_reflected_to_the_owner(tmp_path, kind, exception):
    with reply_once(tmp_path, {'error': kind, 'message': 'SECRET from a remote command'}) as remote:
        with pytest.raises(exception) as error:
            remote._call('binding')
        assert 'SECRET' not in str(error.value)
        assert str(error.value)
