"""Exact update approvals, held claims and recovery share the fleet boundary."""
from dataclasses import replace
from types import SimpleNamespace
import json
import hashlib
from pathlib import Path

import pytest

from sparkie_sparks.application_updates import ApplicationUpdates, StewardClient, reviewed
from sparkie_sparks.authority import Owner, OwnerBinding
from sparkie_sparks.broker import dispatch_request
from sparkie_sparks.composition import compose
from sparkie_sparks.operations import OperationStore

REVIEW = {'release': 'candidate-fixture', 'previous': 'a'*64, 'candidate': 'b'*64,
          'diff': 'Fix sources.', 'checks': 'Original task passed.',
          'interruption': 'Brief chat restart.', 'rollback': 'Restore the retained version.'}
PROPOSAL = 'c'*64


class Steward:
    def __init__(self):
        self.calls, self.state, self.review = [], 'unknown', dict(REVIEW)
        self.lose_reply = False
        self.current = True

    def __call__(self, method, proposal, operation=None):
        self.calls.append((method, proposal, operation))
        if method == 'inspect':
            return {'ok': True, 'review': dict(self.review)}
        if method == 'apply':
            self.state = 'awaiting_owner_check'
        elif method == 'accept':
            self.state = 'succeeded'
        elif method == 'rollback':
            self.state = 'rolled_back'
        if self.lose_reply and method in ('apply', 'rollback'):
            raise RuntimeError('Lost acknowledgement')
        return {'ok': True, 'state': self.state, 'rollback_available': self.current and self.state in ('awaiting_owner_check','succeeded','unknown'),
                'accept_available': self.current and self.state in ('awaiting_owner_check','succeeded')}


@pytest.fixture
def rig(tmp_path):
    store = OperationStore(tmp_path/'operations.sqlite')
    binding = [OwnerBinding('fixture', 'owner', 'basic', '', 123, 123)]
    steward = Steward()
    service = compose(store, [], binding=lambda: binding[0], workloads=SimpleNamespace(nodes={}),
                      updates=ApplicationUpdates(store, client=steward))
    return service, steward, binding


def prepare(service, key='first'):
    return service.prepare_update(Owner('fixture','web'), request_key=key, request_ref='owner chat', proposal=PROPOSAL)


def claim(service):
    with service.store._db() as db:
        return [dict(row) for row in db.execute('SELECT * FROM claims')]


def test_update_requires_exact_owner_then_acceptance_from_either_channel(rig):
    service, steward, _ = rig
    row = prepare(service)
    assert row['state'] == 'pending' and row['can_confirm'] and not claim(service)
    assert service.actions_for('spark1') == frozenset()
    with pytest.raises(ValueError):
        service.prepare(Owner('fixture','web'), request_key='sleep', request_ref='chat', action='sleep', spark='spark1')
    with pytest.raises(PermissionError):
        service.confirm(Owner('fixture','telegram'), row['id'], '0'*64)
    assert not any(c[0] == 'apply' for c in steward.calls)
    installed = service.confirm(Owner('fixture','telegram'), row['id'], row['digest'])
    assert installed['state'] == 'uncertain' and installed['update']['state'] == 'awaiting_owner_check'
    assert installed['can_accept_update'] and installed['can_rollback_update']
    assert claim(service) == [{'spark':'spark1', 'operation':row['id']}]
    assert prepare(service, 'new-attempt')['id'] == row['id']
    with pytest.raises(PermissionError):
        service.confirm(Owner('fixture','web'), row['id'], row['digest'])
    accepted = service.accept_update(Owner('fixture','web'), row['id'], row['digest'])
    assert accepted['state'] == 'succeeded' and not claim(service)
    assert len([c for c in steward.calls if c[0] == 'apply']) == 1


def test_uncertain_ack_is_reconciled_without_reinstallation(rig):
    service, steward, _ = rig
    steward.lose_reply = True
    row = prepare(service)
    result = service.confirm(Owner('fixture','web'), row['id'], row['digest'])
    assert result['update']['state'] == 'awaiting_owner_check'
    service.check(Owner('fixture','telegram'), row['id'])
    assert len([c for c in steward.calls if c[0] == 'apply']) == 1
    with pytest.raises(RuntimeError):
        service.rollback_update(Owner('fixture','telegram'), row['id'], row['digest'])
    result = service.check(Owner('fixture','web'), row['id'])
    assert result['state'] == 'failed' and result['update']['state'] == 'rolled_back' and not claim(service)
    service.rollback_update(Owner('fixture','web'), row['id'], row['digest'])
    assert len([c for c in steward.calls if c[0] == 'rollback']) == 1


def test_changed_review_expiry_generation_and_cancel_do_not_install(rig):
    service, steward, binding = rig
    row = prepare(service)
    steward.review['diff'] = 'different candidate scope'
    assert service.confirm(Owner('fixture','web'), row['id'], row['digest'])['state'] == 'failed'
    assert not any(c[0] == 'apply' for c in steward.calls)
    row = prepare(service, 'expiry')
    service.store.clock = lambda: row['expires'] + 1
    with pytest.raises(PermissionError):
        service.confirm(Owner('fixture','web'), row['id'], row['digest'])
    binding[0] = replace(binding[0], generation='changed')
    with pytest.raises(PermissionError):
        service.get(Owner('fixture','web'), row['id'])
    assert not any(c[0] == 'apply' for c in steward.calls)


def test_model_can_only_prepare_not_confirm_accept_or_restore(rig):
    service, steward, _ = rig
    row = dispatch_request(service, {'method':'propose_update', 'owner':None,
        'params':{'request_key':'model', 'request_ref':'native chat', 'proposal':PROPOSAL}})
    for method in ('confirm','accept_update','rollback_update'):
        with pytest.raises(PermissionError):
            dispatch_request(service, {'method':method, 'owner':None,
                'params':{'operation':row['id'],'digest':row['digest']}})
    assert row['state'] == 'pending' and not any(c[0] in ('apply','accept','rollback') for c in steward.calls)


def test_accepted_rollback_reclaims_host_and_preserves_request(rig):
    service, steward, _ = rig
    owner = Owner('fixture','web')
    row = prepare(service)
    service.confirm(owner,row['id'],row['digest'])
    service.accept_update(owner,row['id'],row['digest'])
    steward.lose_reply = True
    with pytest.raises(RuntimeError):
        service.rollback_update(owner,row['id'],row['digest'])
    assert claim(service) == [{'spark':'spark1','operation':row['id']}]
    assert service.store.get(row['id'])['state'] == 'uncertain'
    assert service.check(owner,row['id'])['update']['state'] == 'rolled_back'
    assert not claim(service)


def test_missing_steward_is_clear_unavailable(tmp_path):
    with pytest.raises(RuntimeError, match='verified response'):
        StewardClient(tmp_path/'absent.sock')('inspect',PROPOSAL)


def test_historical_version_cannot_claim_host_for_a_stale_restore(rig):
    service, steward, _ = rig
    owner = Owner('fixture','web')
    row = prepare(service)
    service.confirm(owner,row['id'],row['digest'])
    service.accept_update(owner,row['id'],row['digest'])
    steward.current = False
    assert not service.get(owner,row['id'])['can_rollback_update']
    with pytest.raises(PermissionError,match='not currently eligible'):
        service.rollback_update(owner,row['id'],row['digest'])
    assert not claim(service) and service.store.get(row['id'])['state'] == 'succeeded'
    assert not any(c[0] == 'rollback' for c in steward.calls)


def test_history_reads_only_the_ledger_until_the_owner_opens_one_update(rig):
    service, steward, _ = rig
    owner = Owner('fixture', 'web')
    row = prepare(service)
    service.confirm(owner, row['id'], row['digest'])
    steward.calls.clear()
    summary = service.capabilities(owner)['operations'][0]
    assert summary['id'] == row['id'] and summary['review_available']
    assert 'review' not in summary['intent'] and not summary['can_accept_update']
    assert not steward.calls
    detail = service.get(owner, row['id'])
    assert detail['can_accept_update'] and detail['intent']['review'] == steward.review
    assert steward.calls == [('observe', PROPOSAL, row['id'])]


def test_model_reads_an_installed_update_waiting_for_owner_verification(rig):
    service, steward, _ = rig
    row = prepare(service)
    installed = service.confirm(Owner('fixture', 'web'), row['id'], row['digest'])
    assert installed['state'] == 'uncertain'
    for read in (service.proposal_status, service.proposal_check):
        result = read(operation=row['id'])
        assert result['update']['state'] == 'awaiting_owner_check'
        assert result['recovery']['operation_terminal'] is False
        assert 'keep it or restore' in result['next_step'] and row['id'] in result['next_step']
        assert 'Call spark_check_change' not in result['next_step']
        assert 'digest' not in result
    assert [call[0] for call in steward.calls if call[0] in ('apply', 'accept', 'rollback')] == ['apply']


def test_review_transfer_verifies_bytes_and_never_overwrites(tmp_path):
    from sparkie_sparks.update_proposals import receive
    inbox = tmp_path/'inbox'; inbox.mkdir(mode=0o700)
    archive = b'fixture archive, independently admitted only after owner approval'
    raw = json.dumps({**REVIEW,'archive':hashlib.sha256(archive).hexdigest()}).encode()
    proposal = hashlib.sha256(raw).hexdigest()
    transfers = []
    def transfer(env, source, target, limit):
        transfers.append(source)
        target.write_bytes(raw if source.endswith('review.json') else archive)
    folder = '/workspace/build/'+proposal
    assert receive(None,folder,proposal,inbox=inbox,transfer=transfer) == proposal
    assert (inbox/proposal/'release.tar').read_bytes() == archive
    assert receive(None,folder,proposal,inbox=inbox,transfer=transfer) == proposal
    assert sum(p.endswith('release.tar') for p in transfers) == 1
    with pytest.raises(ValueError):
        receive(None,'/etc/'+proposal,proposal,inbox=inbox,transfer=transfer)
    with pytest.raises(ValueError):
        receive(None,'/workspace/../'+proposal,proposal,inbox=inbox,transfer=transfer)


def test_corrupt_transfer_never_creates_offer(tmp_path):
    from sparkie_sparks.update_proposals import receive
    inbox = tmp_path/'inbox'; inbox.mkdir(mode=0o700)
    raw = json.dumps({**REVIEW,'archive':'d'*64}).encode()
    proposal = hashlib.sha256(raw).hexdigest()
    def transfer(env, source, target, limit):
        target.write_bytes(raw if source.endswith('review.json') else b'corrupt')
    with pytest.raises(ValueError, match='archive changed'):
        receive(None,'/workspace/'+proposal,proposal,inbox=inbox,transfer=transfer)
    assert list(inbox.iterdir()) == []


def test_existing_partial_or_corrupt_offer_is_not_reported_usable(tmp_path):
    from sparkie_sparks.update_proposals import receive
    inbox = tmp_path/'inbox'; inbox.mkdir(mode=0o700)
    archive = b'complete reviewed archive'
    raw = json.dumps({**REVIEW,'archive':hashlib.sha256(archive).hexdigest()}).encode()
    proposal = hashlib.sha256(raw).hexdigest()
    target = inbox/proposal; target.mkdir()
    def transfer(env, source, destination, limit):
        destination.write_bytes(raw)
    with pytest.raises(OSError):
        receive(None,'/workspace/'+proposal,proposal,inbox=inbox,transfer=transfer)
    (target/'review.json').write_bytes(raw)
    (target/'release.tar').write_bytes(b'truncated')
    with pytest.raises(ValueError, match='does not match'):
        receive(None,'/workspace/'+proposal,proposal,inbox=inbox,transfer=transfer)


@pytest.mark.parametrize('letter', ['x', 'é'])
def test_complete_large_review_crosses_real_private_socket(rig, tmp_path, letter):
    import os
    import threading
    from sparkie_sparks.broker import FleetServer, RemoteControls
    service, steward, _ = rig
    # UTF-8 stays below the sealed-review total limit; escaped JSON would exceed
    # the former reply cap. Every field must survive the actual Unix socket.
    for name in ('diff','checks','interruption','rollback'):
        steward.review[name] = letter * (4000 if letter == 'x' else 2800)
    owner = Owner('fixture','web')
    with FleetServer(tmp_path/'private/fleet.sock',service,gateway_uid=os.geteuid()) as server:
        thread = threading.Thread(target=server.serve_forever,daemon=True); thread.start()
        try:
            remote = RemoteControls(tmp_path/'private/fleet.sock')
            row = remote.prepare_update(owner,request_key='big',request_ref='native chat',proposal=PROPOSAL)
            assert row['intent']['review'] == steward.review
            assert remote.get(owner,row['id'])['description'] == row['description']
            recent = remote.recent(owner)[0]
            assert recent['review_available'] and not recent['can_confirm']
            assert 'review' not in recent['intent'] and len(recent['description']) < 200
            assert remote.confirm(owner,row['id'],row['digest'])['can_accept_update']
            assert remote.accept_update(owner,row['id'],row['digest'])['state'] == 'succeeded'
        finally:
            server.shutdown(); thread.join(2)


def test_saved_repair_review_is_exact_complete_and_atomic(tmp_path, monkeypatch):
    import zipfile
    from sparkie_sparks import update_proposals

    contents = {'repair.patch.txt': b'diff --git a/old b/new\n+new\n',
                'checks.txt': b'One passed.\nTwo blocked.\n'}
    expected = {field: hashlib.sha256(contents[name]).hexdigest() for field, name in
                [('patch', 'repair.patch.txt'), ('checks', 'checks.txt')]}
    def transfer(environment, source, destination, limit):
        assert Path(source).parent.as_posix() == '/workspace/sparkie-review'
        assert limit == 1024 * 1024
        destination.write_bytes(contents[Path(source).name])

    monkeypatch.setattr(update_proposals, 'fetch', transfer)
    with pytest.raises(ValueError, match='checks'):
        update_proposals.save_review_files(None, {**expected, 'checks': '0' * 64}, tmp_path)
    assert not list(tmp_path.iterdir())

    def publication_failure(*args):
        raise OSError('test publication failure')

    with monkeypatch.context() as patch:
        patch.setattr(update_proposals.os, 'replace', publication_failure)
        with pytest.raises(OSError, match='publication'):
            update_proposals.save_review_files(None, expected, tmp_path)
    assert not list(tmp_path.iterdir())

    result = update_proposals.save_review_files(None, expected, tmp_path)
    archive = Path(result['file'])
    assert list(tmp_path.iterdir()) == [archive]
    assert archive.stat().st_mode & 0o777 == 0o600
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == result['sha256']
    assert result['patch_sha256'] == expected['patch'] and result['checks_sha256'] == expected['checks']
    with zipfile.ZipFile(archive) as bundle:
        assert sorted(bundle.namelist()) == ['checks.txt', 'repair.patch']
        assert bundle.read('repair.patch') == contents['repair.patch.txt']
        assert bundle.read('checks.txt') == contents['checks.txt']
    assert update_proposals.save_review_files(None, expected, tmp_path) == result
    assert list(tmp_path.iterdir()) == [archive]


def test_hermes_attaches_only_reviews_saved_by_this_handler_in_this_turn():
    from sparkie_sparks.update_proposals import ReviewAttachments

    attachments = ReviewAttachments()
    path = '/profile/cache/documents/sparkie-review-' + '1' * 64 + '.zip'
    final = 'Downloadable copy:\n' + path
    def save():
        attachments.saved(path)
        return 'real tool result'

    def dispatch(name, run, session='owner', turn='one'):
        return attachments.executing(name, run, session_id=session, turn_id=turn)

    dispatch('spark_retain_repair_review', lambda: final)
    dispatch('other_tool', save)
    dispatch('spark_retain_repair_review', save, turn='')
    assert attachments.attach(final, 'owner', 'one') is None
    assert dispatch('spark_retain_repair_review', save) == 'real tool result'
    dispatch('spark_retain_repair_review', save)
    assert attachments.attach(final, 'other', 'one') is None
    assert attachments.attach(final, 'owner', 'two') is None
    assert attachments.attach(final, 'owner', 'one') == 'MEDIA:' + path + '\n\n' + final
    assert attachments.attach(final, 'owner', 'one') is None
