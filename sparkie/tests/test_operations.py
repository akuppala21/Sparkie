"""Faults at the fleet boundary. No real machine, root command or plug is touched."""

from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest

from sparkie_sparks.authority import Owner
from sparkie_sparks.operations import OperationStore

WEB = Owner('paired-generation-1', 'web')
TELEGRAM = Owner('paired-generation-1', 'telegram')


def prepared(tmp_path, *, action='wake', now=None):
    store = OperationStore(tmp_path / 'operations.sqlite', clock=(lambda: now[0]) if now else lambda: 1000)
    row = store.prepare(WEB, request_key='web-request-1', request_ref='session:fixture:message:1',
                        action=action, spark='spark2', **({'container': 'a' * 64} if action == 'stop_workload' else {}))
    return store, row


def approved(tmp_path, **kwargs):
    store, row = prepared(tmp_path, **kwargs)
    return store, store.confirm(TELEGRAM, row['id'], row['digest'])


def test_web_request_can_be_confirmed_in_telegram_then_only_dispatched_once(tmp_path):
    store, row = approved(tmp_path)
    assert row['channel'] == 'web' and row['approved_channel'] == 'telegram'
    sends = []
    for _ in range(2):
        result = store.run(WEB, row['id'], dispatch=lambda *args: sends.append(args), observe=lambda *args: 'succeeded')
        assert result['state'] == 'succeeded'
    assert len(sends) == 1
    replay = store.prepare(TELEGRAM, request_key='web-request-1', request_ref='session:fixture:message:1',
                           action='wake', spark='spark2')
    assert replay['id'] == row['id'] and replay['state'] == 'succeeded'


def test_pending_or_model_written_approval_cannot_dispatch(tmp_path):
    store, row = prepared(tmp_path)
    sends = []
    assert store.run(WEB, row['id'], dispatch=lambda *args: sends.append(args), observe=lambda *args: 'succeeded')['state'] == 'pending'
    with pytest.raises(PermissionError):
        store.confirm({'generation': WEB.generation, 'channel': 'web'}, row['id'], row['digest'])
    assert sends == []


@pytest.mark.parametrize('spark', ['spark1', 'hub', 'spark5', '../spark2'])
def test_hub_and_unknown_targets_are_refused_before_recording(tmp_path, spark):
    store = OperationStore(tmp_path / 'operations.sqlite')
    for action in ('wake', 'sleep', 'stop_workload'):
        with pytest.raises(ValueError):
            store.prepare(WEB, request_key='1', request_ref='fixture', action=action, spark=spark)


def test_changed_target_or_container_cannot_reuse_request_or_confirmation(tmp_path):
    store, row = prepared(tmp_path, action='stop_workload')
    with pytest.raises(ValueError):
        store.prepare(WEB, request_key='web-request-1', request_ref='session:fixture:message:1',
                      action='stop_workload', spark='spark2', container='b' * 64)
    with pytest.raises(PermissionError):
        store.confirm(WEB, row['id'], '0' * 64)


def test_expiry_and_revocation_are_checked_at_confirmation_and_dispatch(tmp_path):
    now = [1000]
    store, row = prepared(tmp_path, now=now)
    with pytest.raises(PermissionError):
        store.confirm(Owner('new-generation', 'telegram'), row['id'], row['digest'])
    store.confirm(WEB, row['id'], row['digest'])
    with pytest.raises(PermissionError):
        store.confirm(WEB, row['id'], row['digest'])
    with pytest.raises(PermissionError):
        store.run(Owner('new-generation', 'web'), row['id'], dispatch=lambda *a: None, observe=lambda *a: 'succeeded')
    now[0] = row['expires']
    with pytest.raises(PermissionError):
        store.run(WEB, row['id'], dispatch=lambda *a: None, observe=lambda *a: 'succeeded')


def test_timeout_holds_claim_until_restart_reconciles_without_resending(tmp_path):
    store, row = approved(tmp_path, action='stop_workload')
    sends = []
    def send(*args):
        sends.append(args)
        raise TimeoutError('SECRET must not be recorded')
    result = store.run(WEB, row['id'], dispatch=send, observe=lambda *a: 'unknown')
    assert result['state'] == 'uncertain'
    assert 'SECRET' not in str(result)
    second = store.prepare(WEB, request_key='second', request_ref='fixture:second', action='sleep', spark='spark2')
    store.confirm(WEB, second['id'], second['digest'])
    with pytest.raises(RuntimeError):
        store.run(WEB, second['id'], dispatch=send, observe=lambda *a: 'succeeded')
    reopened = OperationStore(store.path, clock=lambda: 1000)
    assert reopened.run(WEB, row['id'], dispatch=send, observe=lambda *a: 'succeeded')['state'] == 'uncertain'
    assert reopened.reconcile(row['id'], observe=lambda *a: 'succeeded')['state'] == 'succeeded'
    assert len(sends) == 1
    assert reopened.run(WEB, second['id'], dispatch=lambda *a: None, observe=lambda *a: 'succeeded')['state'] == 'succeeded'


def test_process_crash_after_dispatch_does_not_lose_the_operation(tmp_path):
    store, row = approved(tmp_path)
    def crash(*args):
        raise SystemExit('simulated process exit after sending')
    with pytest.raises(SystemExit):
        store.run(WEB, row['id'], dispatch=crash, observe=lambda *a: 'succeeded')
    reopened = OperationStore(store.path)
    assert reopened.get(row['id'])['state'] == 'dispatching'
    assert reopened.reconcile(row['id'], observe=lambda *a: 'succeeded')['state'] == 'succeeded'


def test_native_confirmation_records_claim_and_dispatch_before_a_crash(tmp_path):
    store, row = prepared(tmp_path)
    sends = []
    def crash(operation, target):
        saved = store.get(operation)
        assert saved['state'] == 'dispatching'
        assert saved['approved_at'] == 1000 and saved['approved_channel'] == 'telegram'
        with store._db() as db:
            assert db.execute('SELECT operation FROM claims WHERE spark=?', ('spark2',)).fetchone()[0] == operation
        sends.append(operation)
        raise SystemExit('simulated exit before a dispatch reply')
    with pytest.raises(SystemExit):
        store.run(TELEGRAM, row['id'], approval_digest=row['digest'], dispatch=crash, observe=lambda *a: 'unknown')
    reopened = OperationStore(store.path, clock=lambda: 1000)
    assert reopened.get(row['id'])['state'] == 'dispatching'
    with pytest.raises(PermissionError):
        reopened.run(WEB, row['id'], approval_digest=row['digest'], dispatch=crash, observe=lambda *a: 'succeeded')
    assert reopened.reconcile(row['id'], observe=lambda *a: 'succeeded')['state'] == 'succeeded'
    assert sends == [row['id']]


@pytest.mark.parametrize('digest', [None, '', '0' * 64])
def test_explicit_invalid_confirmation_cannot_use_a_preapproved_receipt(tmp_path, digest):
    store, row = approved(tmp_path)
    sends = []
    with pytest.raises(PermissionError):
        store.run(WEB, row['id'], approval_digest=digest, dispatch=lambda *a: sends.append(a), observe=lambda *a: 'succeeded')
    assert sends == []


def test_confirmed_failure_stays_failed_and_is_not_silently_retried(tmp_path):
    store, row = approved(tmp_path, action='stop_workload')
    sends = []
    def send(*args): sends.append(args)
    for _ in range(2):
        assert store.run(WEB, row['id'], dispatch=send, observe=lambda *a: 'failed')['state'] == 'failed'
    assert len(sends) == 1


def test_cancel_before_send_runs_nothing_and_cancel_during_send_does_not_claim_stopped(tmp_path):
    store, row = approved(tmp_path)
    store.cancel(WEB, row['id'])
    sends = []
    assert store.run(WEB, row['id'], dispatch=lambda *a: sends.append(a), observe=lambda *a: 'succeeded')['state'] == 'cancelled'
    assert sends == []
    second = store.prepare(WEB, request_key='second', request_ref='fixture:second', action='wake', spark='spark3')
    store.confirm(WEB, second['id'], second['digest'])
    def dispatch(operation, target):
        cancelled = store.cancel(TELEGRAM, operation)
        assert cancelled['state'] == 'dispatching' and cancelled['cancel_requested']
    result = store.run(WEB, second['id'], dispatch=dispatch, observe=lambda *a: 'unknown')
    assert result['state'] == 'uncertain' and result['cancel_requested']


def test_concurrent_delivery_and_reconcile_cannot_duplicate_or_close_an_active_send(tmp_path):
    store, row = approved(tmp_path)
    started, finish = Event(), Event()
    sends = []
    def send(*args):
        sends.append(args)
        started.set()
        assert finish.wait(5)
    with ThreadPoolExecutor(max_workers=2) as pool:
        future = pool.submit(store.run, WEB, row['id'], dispatch=send, observe=lambda *a: 'succeeded')
        assert started.wait(5)
        try:
            assert store.run(TELEGRAM, row['id'], dispatch=send, observe=lambda *a: 'succeeded')['state'] == 'dispatching'
            assert store.reconcile(row['id'], observe=lambda *a: 'failed')['state'] == 'dispatching'
        finally:
            finish.set()
        assert future.result()['state'] == 'succeeded'
    assert len(sends) == 1

