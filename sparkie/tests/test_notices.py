"""Deferred completion through native CLI with captured transport, never a live bot."""
import argparse
from contextlib import redirect_stdout
from dataclasses import asdict
import io
import json
from pathlib import Path
import subprocess
import sys

import pytest

from sparkie_sparks.authority import Owner, OwnerBinding
from sparkie_sparks.broker import dispatch_request
from sparkie_sparks.controls import Controls
from sparkie_sparks.notices import CompletionNotices, NativeTelegramSender
from sparkie_sparks.operations import NotDispatched, OperationStore


@pytest.fixture
def rig(tmp_path):
    binding = [OwnerBinding('first', 'owner', 'sparkie-owner', 'https://fixture.invalid', 12345, 12345)]
    state, effects = ['unknown'], []
    controls = Controls(OperationStore(tmp_path / 'operations.sqlite'), binding=lambda: binding[0],
        dispatch=lambda *a: effects.append(a), observe=lambda *a: state[0])
    owner = Owner('first', 'telegram')
    row = controls.prepare(owner, request_key='telegram:12345:8', request_ref='telegram:12345:8',
                           action='sleep', spark='spark4')
    controls.bind_notice(owner, row['id'])
    return controls, owner, row, binding, state, effects


def finish(rig):
    controls, owner, row, _, state, _ = rig
    assert controls.confirm(owner, row['id'], row['digest'])['state'] == 'uncertain'
    state[0] = 'succeeded'
    assert controls.check(owner, row['id'])['state'] == 'succeeded'


def test_terminal_completion_once_after_broker_restart(rig):
    controls, _, row, binding, _, effects = rig
    finish(rig)
    # Reopen the actual durable ledger; no process-local delivery handles survive.
    resumed = CompletionNotices(OperationStore(controls.store.path), binding=lambda: binding[0])
    sent = []
    def sender(**request):
        assert request['authorized']()
        sent.append(request)
        return True
    assert resumed.deliver(sender, view=controls.view) == [{'operation': row['id'], 'notification': 'sent'}]
    assert resumed.deliver(sender, view=controls.view) == []
    assert len(sent) == len(effects) == 1
    assert sent[0]['chat'] == 12345 and row['id'] in sent[0]['text']


def test_uncertain_hardware_is_never_announced_as_complete(rig):
    controls, owner, row, *_ = rig
    controls.confirm(owner, row['id'], row['digest'])
    assert controls.notices.deliver(lambda **kw: pytest.fail('not terminal'), view=controls.view) == []
    assert controls.notices.status(row['id']) == 'pending'


def test_failed_completion_uses_same_recovery_disposition_without_retry(rig):
    from sparkie_sparks.controls import result_text
    controls, owner, row, _, state, effects = rig
    controls.confirm(owner, row['id'], row['digest'])
    state[0] = 'failed'
    failed = controls.check(owner, row['id'])
    sent = []
    assert controls.notices.deliver(lambda **request: sent.append(request) or True,
                                   view=controls.view)[0]['notification'] == 'sent'
    assert sent[0]['text'] == result_text(failed)
    assert failed['recovery']['operation_terminal'] is True
    assert failed['recovery']['retry_policy'] == 'review_required'
    assert 'does not establish the current machine state' in sent[0]['text']
    assert controls.notices.deliver(lambda **_: pytest.fail('Do not repeat the notice'), view=controls.view) == []
    assert len(effects) == 1


@pytest.mark.parametrize('replacement', [
    OwnerBinding('revoked', 'owner', 'sparkie-owner', 'https://fixture.invalid', 12345, 12345),
    OwnerBinding('first', 'owner', 'sparkie-owner', 'https://fixture.invalid', 999, 999),
])
def test_revoked_generation_or_changed_chat_is_suppressed(rig, replacement):
    controls, _, row, binding, *_ = rig
    finish(rig)
    binding[0] = replacement
    assert controls.notices.deliver(lambda **kw: pytest.fail('revoked'), view=controls.view)[0]['notification'] == 'suppressed'
    assert controls.notices.status(row['id']) == 'suppressed'


@pytest.mark.parametrize('response', [False, 'raised', 'crashed'])
def test_ambiguous_send_or_lost_process_receipt_never_replays(rig, response):
    controls, owner, row, *_ = rig
    finish(rig)
    calls = []
    def sender(**request):
        calls.append(1)
        if response == 'raised':
            raise subprocess.TimeoutExpired('native-send', 20)
        return False
    if response == 'crashed':
        controls.notices._state(row['id'], 'dispatching')
    assert controls.notices.deliver(sender, view=controls.view)[0]['notification'] == 'unknown'
    assert controls.notices.deliver(sender, view=controls.view) == []
    assert len(calls) == (0 if response == 'crashed' else 1)
    assert 'not retried' in controls.get(owner, row['id'])['message']


def test_immediate_result_does_not_send_a_second_completion_card(rig):
    controls, owner, row, _, state, _ = rig
    state[0] = 'succeeded'
    controls.confirm(owner, row['id'], row['digest'])
    assert controls.notices.deliver(lambda **kw: pytest.fail('already returned inline'), view=controls.view) == []


def test_proven_not_dispatched_can_recover_but_is_not_claimed_sent(rig):
    controls, _, row, *_ = rig
    finish(rig)
    def unavailable(**request):
        raise NotDispatched('No process started.')
    assert controls.notices.deliver(unavailable, view=controls.view)[0]['notification'] == 'unavailable'
    def recovered(**request):
        assert 'could not be sent' not in request['text']
        return True
    assert controls.notices.deliver(recovered, view=controls.view)[0]['notification'] == 'sent'


def test_origin_cannot_be_bound_by_web_or_changed_after_dispatch(rig):
    controls, owner, row, binding, *_ = rig
    with pytest.raises(PermissionError):
        dispatch_request(controls, {'method': 'bind_notice', 'owner': asdict(Owner('first', 'web')),
                                   'params': {'operation': row['id']}})
    with pytest.raises(PermissionError):
        dispatch_request(controls, {'method': 'bind_notice', 'owner': None,
                                   'params': {'operation': row['id']}})
    with pytest.raises(ValueError):
        dispatch_request(controls, {'method': 'bind_notice', 'owner': asdict(owner),
                                   'params': {'operation': row['id'], 'chat': 999}})
    assert dispatch_request(controls, {'method': 'bind_notice', 'owner': asdict(owner),
                                      'params': {'operation': row['id']}}) is None
    binding[0] = OwnerBinding('first', 'owner', 'sparkie-owner', 'https://fixture.invalid', 999, 999)
    with pytest.raises(PermissionError):
        controls.bind_notice(owner, row['id'])


def test_web_origin_does_not_become_telegram_when_viewed_there(rig):
    controls, _, _, _, state, _ = rig
    web, telegram = Owner('first', 'web'), Owner('first', 'telegram')
    row = controls.prepare(web, request_key='web:one', request_ref='web:one', action='wake', spark='spark2')
    controls.get(telegram, row['id'])
    controls.store.bind_telegram_card(telegram, row['id'], chat=12345, message=99)
    controls.confirm(telegram, row['id'], row['digest'])
    state[0] = 'succeeded'
    controls.check(telegram, row['id'])
    assert controls.notices.status(row['id']) is None


@pytest.fixture
def sender_config(tmp_path):
    home, source = tmp_path / 'home', tmp_path / 'candidate/hermes'
    home.mkdir(); source.mkdir(parents=True)
    (home / '.env').write_text(''); (home / '.env').chmod(0o600)
    environment = tmp_path / 'owner.env'
    environment.write_text('TELEGRAM_BOT_TOKEN="fixture-not-a-token"\nTELEGRAM_ALLOWED_USERS="12345"\n'
                           'TELEGRAM_HOME_CHANNEL="12345"\nUNRELATED_SECRET="must-not-pass"\n')
    environment.chmod(0o600)
    return {'home': str(home), 'environment': str(environment), 'source': str(source),
            'python': str(source / '.venv/bin/python')}


def test_sender_pins_native_cli_and_extracts_only_required_secrets(sender_config):
    calls = []
    def runner(argv, **kwargs):
        calls.append((argv, kwargs))
        return subprocess.CompletedProcess(argv, 0, '{"success":true,"message_id":"8"}', '')
    sender = NativeTelegramSender(sender_config, runner=runner)
    assert sender(chat=12345, text='Verified completion.', authorized=lambda: True)
    argv, kwargs = calls[0]
    assert argv == [sender_config['python'], '-m', 'hermes_cli.main', 'send', '--to', 'telegram:12345', '--file', '-', '--json']
    assert kwargs['input'] == 'Verified completion.' and kwargs['timeout'] <= 20
    assert 'UNRELATED_SECRET' not in kwargs['env']
    assert kwargs['env']['HERMES_MANAGED_DIR'] == sender_config['home'] + '/managed'
    assert kwargs['env']['TELEGRAM_BOT_TOKEN'] == 'fixture-not-a-token'
    assert 'fixture-not-a-token' not in str(argv)


@pytest.mark.parametrize('fault', ['revoked', 'mismatch', 'profile_override', 'symlink'])
def test_native_send_preflight_refuses_before_process_start(sender_config, fault):
    if fault == 'profile_override':
        Path(sender_config['home'], '.env').write_text('TELEGRAM_HOME_CHANNEL=999\n')
    if fault == 'symlink':
        path = Path(sender_config['environment']); target = path.with_suffix('.private')
        path.rename(target); path.symlink_to(target)
    sender = NativeTelegramSender(sender_config, runner=lambda *a, **kw: pytest.fail('must not spawn'))
    with pytest.raises(NotDispatched):
        sender(chat=999 if fault == 'mismatch' else 12345, text='result', authorized=lambda: fault != 'revoked')


@pytest.mark.integration
def test_real_native_cli_parses_stdin_and_calls_only_captured_outbound(sender_config, monkeypatch):
    from hermes_cli.send_cmd import register_send_subparser
    from gateway.outbound import send
    sent = []
    monkeypatch.setattr(send, 'send_message_tool', lambda args: sent.append(args) or '{"success":true,"message_id":"9"}')
    def runner(argv, **kwargs):
        parser = argparse.ArgumentParser()
        register_send_subparser(parser.add_subparsers())
        args = parser.parse_args(argv[3:])
        captured = io.StringIO()
        with monkeypatch.context() as patched:
            for key, value in kwargs['env'].items(): patched.setenv(key, value)
            patched.setattr(sys, 'stdin', io.StringIO(kwargs['input']))
            with redirect_stdout(captured), pytest.raises(SystemExit) as finished:
                args.func(args)
        return subprocess.CompletedProcess(argv, finished.value.code, captured.getvalue(), '')
    assert NativeTelegramSender(sender_config, runner=runner)(chat=12345, text='Actual observed result.', authorized=lambda: True)
    assert sent == [{'action': 'send', 'target': 'telegram:12345', 'message': 'Actual observed result.'}]
