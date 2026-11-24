"""Bind the native owner chat to the bounded memory wait and its existing display."""
from contextlib import contextmanager, nullcontext
from io import BytesIO

from starlette.exceptions import HTTPException

from .memory_review import default_home, owner_memory_turn

PENDING = "A memory change is waiting for your decision. Open Memory changes on Home or send /memoryreview in the paired Telegram chat."


def project_held_row(row):
    """Expose display text and native row identity without model-only replay fields."""
    if not isinstance(row, dict) or row.get('role') != 'assistant':
        return row
    metadata = row.get('display_metadata')
    if not isinstance(metadata, dict) or not metadata.get('sparkie_memory_display'):
        return row
    visible = {key: row[key] for key in ('id', '_row_id', 'row_id', 'session_id', 'timestamp',
               'role', 'display_kind', 'tool_calls', 'tool_call_labels') if key in row}
    if row.get('display_kind') != 'hidden':
        visible.update((key, row[key]) for key in ('text', 'content') if key in row)
    return visible


@contextmanager
def _turn(agent, channel, notify, cancelled, matches_owner):
    if not {'memory', 'tool_call'}.intersection(getattr(agent, 'valid_tool_names', ())):
        yield
        return
    agent._sparkie_memory_chat = channel
    agent._sparkie_memory_outcomes = []

    def checked(receipt):
        message = receipt['message']
        agent._sparkie_memory_outcomes.append((receipt['state'], message))
        notify(message)

    try:
        with owner_memory_turn(agent.session_id, on_pending=lambda _: notify(PENDING), cancelled=cancelled,
                               on_outcome=checked, matches_owner=matches_owner):
            yield
    finally:
        agent._sparkie_memory_chat = False
        agent._sparkie_memory_outcomes = []


def checked_reply(agent, text):
    outcomes = getattr(agent, '_sparkie_memory_outcomes', ())
    if not outcomes:
        return text
    checked = '\n'.join(message for _, message in outcomes)
    if any(state in ('owner_unverified', 'enrollment_changed') for state, _ in outcomes):
        return checked
    if not text or not text.strip() or text.strip() == checked:
        return checked
    if all(state == 'saved' for state, _ in outcomes):
        return text if checked in text else checked + '\n\n' + text
    try:
        content = ('Unverified assistant draft. The checked memory outcome follows.\n' +
                   checked + '\n\n' + text).encode()
        filename = 'unverified-assistant-draft.txt'
        if agent._sparkie_memory_chat == 'telegram':
            from gateway.platforms.base import cache_document_from_bytes
            draft = cache_document_from_bytes(content, filename)
        else:
            # The Webapp ticket resolver recognizes this profile's staged uploads on the host
            # even when its regular files belong to a remote compute workspace.
            from hermes_cli.staged_uploads import publish_staged_upload
            draft = publish_staged_upload(BytesIO(content), default_home(), filename)
    except (HTTPException, OSError, UnicodeError, ValueError):
        return checked + '\n\nThe unverified assistant draft could not be attached.'
    return checked + '\n\nOpen the attached text file to read the unverified assistant draft.\nMEDIA:' + str(draft)


def web_turn(agent, transport, is_foreground, notify, cancelled):
    identity = getattr(transport, 'auth_identity', None)
    if not is_foreground or not isinstance(identity, dict):
        return nullcontext()
    subject = (identity.get('user_id'), identity.get('provider'), identity.get('issuer') or '')
    def matches_owner(binding):
        return subject == (binding.web_user, binding.web_provider, binding.web_issuer)
    return _turn(agent, 'web', notify, cancelled, matches_owner)


def gateway_turn(agent, runner):
    from gateway.config import Platform
    from gateway.session_ingress import viewer_turn
    from gateway.owner_identity import host_owner_subject

    ctx = runner._ctx
    source = ctx.source
    if ctx.persist_user_display_kind or ctx.scheduled_heartbeat or ctx.mute_notification_reply:
        return nullcontext()
    viewer = viewer_turn.get()
    matches_owner = None
    if source.platform == Platform.TELEGRAM:
        subject = (source.chat_type, source.is_bot, source.user_id, source.chat_id)
        def matches_owner(binding):
            return subject == ('dm', False, str(binding.telegram_user), str(binding.telegram_chat))
    elif source.platform != Platform.LOCAL or viewer is None or source.user_id != host_owner_subject():
        return nullcontext()
    if viewer is not None:
        channel = 'web'
        def notify(text):
            runner._publish_execution('status.update', {'kind': 'memory', 'text': text})
    else:
        channel = 'telegram'
        def notify(text):
            runner._schedule(runner._runner._deliver_platform_notice(source, text), 'Memory review notice delivery failed')
    return _turn(agent, channel, notify, lambda: not ctx._run_still_current() or bool(getattr(agent, '_interrupt_requested', False)), matches_owner)
