from types import SimpleNamespace as Namespace

import pytest

from sparkie_sparks.authority import OwnerBinding, require_human_decision

BINDING = OwnerBinding('fixture-generation', 'owner', 'basic', '', 12345, 12345)


def test_native_owner_identity_is_equal_in_authority_across_web_and_telegram():
    web = BINDING.web(Namespace(state=Namespace(session=Namespace(user_id='owner', provider='basic', issuer=''))))
    telegram = BINDING.telegram(Namespace(effective_user=Namespace(id=12345, is_bot=False),
                                         effective_chat=Namespace(id=12345, type='private')))
    assert web.generation == telegram.generation
    assert web.channel == 'web' and telegram.channel == 'telegram'


@pytest.mark.parametrize('user,chat,kind,bot', [(9, 12345, 'private', False), (12345, -99, 'group', False),
                                              (12345, 12345, 'private', True)])
def test_wrong_sender_group_or_bot_has_no_owner_authority(user, chat, kind, bot):
    with pytest.raises(PermissionError):
        BINDING.telegram(Namespace(effective_user=Namespace(id=user, is_bot=bot),
                                   effective_chat=Namespace(id=chat, type=kind)))


def test_request_body_and_session_token_are_not_an_owner_login():
    for request in (Namespace(body={'user_id': 'owner'}), Namespace(state=Namespace(token_authenticated=True)),
                    Namespace(state=Namespace(session=Namespace(user_id='owner', provider='other', issuer='')))):
        with pytest.raises(PermissionError):
            BINDING.web(request)


@pytest.mark.parametrize('decision', [{'approved': True}, {'approved': True, 'user_approved': False},
                                     {'approved': False, 'user_approved': True}, 'yes', {'approved': 1, 'user_approved': True}])
def test_native_automatic_allowlist_or_model_answers_are_not_exact_human_approval(decision):
    with pytest.raises(PermissionError):
        require_human_decision(decision)


def test_explicit_native_human_approval_can_be_used_by_trusted_transport():
    require_human_decision({'approved': True, 'user_approved': True})
