"""Check the actual pinned Hermes and Telegram data types; no real bot or owner."""

from datetime import datetime, timezone
import secrets
from types import SimpleNamespace as Namespace

import pytest

from sparkie_sparks.authority import OwnerBinding, require_human_decision

pytestmark = pytest.mark.integration


def test_real_hermes_login_and_telegram_update_resolve_to_the_same_configured_owner():
    from plugins.dashboard_auth.basic import BasicAuthProvider, hash_password
    from telegram import Chat, Message, Update, User

    binding = OwnerBinding('fixture-generation', 'fixture-owner', 'basic', '', 12345, 12345)
    provider = BasicAuthProvider(username='fixture-owner', password_hash=hash_password('fixture-password'),
                                 secret=secrets.token_bytes(32))
    signed = provider.complete_password_login(username='fixture-owner', password='fixture-password')
    session = provider.verify_session(access_token=signed.access_token)
    web = binding.web(Namespace(state=Namespace(session=session)))
    update = Update(101, message=Message(202, datetime.now(timezone.utc), Chat(12345, 'private'),
                                        from_user=User(12345, 'Fixture', False), text='/spark confirm fixture'))
    tg = binding.telegram(update)
    assert web.generation == tg.generation
    provider.revoke_access_session(access_token=signed.access_token)
    with pytest.raises(PermissionError):
        binding.web(Namespace(state=Namespace(session=provider.verify_session(access_token=signed.access_token))))


def test_native_generic_approval_does_not_distinguish_manual_from_bypass(monkeypatch):
    from tools import approval, approval_context

    monkeypatch.setattr(approval, '_yolo_active', lambda: False)
    monkeypatch.setattr(approval_context, '_get_approval_mode', lambda: 'manual')
    monkeypatch.setattr(approval, 'is_approved', lambda *a: False)
    monkeypatch.setattr(approval, '_presence', lambda callback: (callback, True, False, False))
    answered = []
    def once(*args, **kwargs):
        answered.append(True)
        return 'once'
    monkeypatch.setattr(approval, 'prompt_dangerous_approval', once)
    human = approval.request_tool_approval('fixture_action', 'Exact fixture operation', rule_key='fixture')
    assert answered == [True] and human['approved'] is True
    monkeypatch.setattr(approval, '_yolo_active', lambda: True)
    bypass = approval.request_tool_approval('fixture_action', 'Exact fixture operation', rule_key='fixture')
    assert bypass == human and 'user_approved' not in human
    for result in (human, bypass):
        with pytest.raises(PermissionError):
            require_human_decision(result)
