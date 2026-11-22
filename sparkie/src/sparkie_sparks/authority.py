"""Bind native, already-authenticated owner events to the fleet boundary.

These functions belong to trusted transport adapters, never to model tool arguments.
An Owner is process-local context, not a bearer credential. The deployed executor
must remain inaccessible to model-run code; these checks alone do not isolate it.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Owner:
    generation: str
    channel: str


@dataclass(frozen=True)
class OwnerBinding:
    generation: str
    web_user: str
    web_provider: str
    web_issuer: str
    telegram_user: int
    telegram_chat: int

    def __post_init__(self):
        if not self.generation or not self.web_user or not self.web_provider:
            raise ValueError('Configure the verified owner before enabling fleet changes.')
        if type(self.telegram_user) is not int or type(self.telegram_chat) is not int:
            raise ValueError('Telegram owner and private chat IDs must be integers.')
        if self.telegram_user <= 0 or self.telegram_chat != self.telegram_user:
            raise ValueError('Use the paired owner’s private Telegram chat.')

    def web(self, request):
        """Hermes middleware supplies request.state.session; request bodies supply nothing."""
        session = getattr(getattr(request, 'state', None), 'session', None)
        if session is None or (getattr(session, 'user_id', None),
                               getattr(session, 'provider', None),
                               getattr(session, 'issuer', '') or '') != (
                                   self.web_user, self.web_provider, self.web_issuer):
            raise PermissionError('Sign in as the configured owner.')
        return Owner(self.generation, 'web')

    def telegram(self, update):
        """Use a native Telegram update, not a username or model-provided chat ID."""
        user, chat = getattr(update, 'effective_user', None), getattr(update, 'effective_chat', None)
        if (getattr(user, 'id', None) != self.telegram_user
                or getattr(user, 'is_bot', True) is not False
                or getattr(chat, 'id', None) != self.telegram_chat
                or getattr(chat, 'type', None) != 'private'):
            raise PermissionError('Use the paired owner’s private Telegram chat.')
        return Owner(self.generation, 'telegram')


def require_human_decision(result):
    """A plain native approval boolean cannot establish human confirmation.

    v0.23.2 request_tool_approval omits this marker even after a human answer.
    Do not wire that generic result to fleet confirmations: use a verified native
    owner button/command and the exact operation digest. A marker alone still
    requires owner identity and operation binding outside this function.
    """
    if not isinstance(result, dict) or result.get('approved') is not True or result.get('user_approved') is not True:
        raise PermissionError('This action needs the owner’s confirmation.')

