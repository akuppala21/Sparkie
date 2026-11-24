"""Scoped native Telegram controls, independent of model availability.

Only the actual private-owner Update can request/confirm. Buttons are tied to a
message issued by this adapter and a stored immutable intention. No real bot is
started by importing or registering this module.
"""

import asyncio
import re
from .controls import configured, result_text
from .authority import Owner
from .application_updates import ACTION as UPDATE_ACTION
from .memory_controls import ERASE_ACTION, default_profile

PATTERN = r'^sparkie:(confirm|cancel|check|accept_update|rollback_update):([a-f0-9]{32})$'
HELP = ('Use /spark wake spark2, /spark sleep spark2, or /spark stop spark2 <full container ID>. '
        'Use /spark services, /spark run <recipe> <spark>, /spark stop-service <recipe> <instance>, '
        '/spark logs <recipe> <instance>, or /spark open <recipe>. '
        'Use /spark recent to review requests, or /spark show <request ID> to get its buttons. '
        'Use /sparks update <proposal SHA-256> to review a prepared application update. '
        'Spark 1 always stays on.')

# The existing native Telegram connection owns the bot and event loop. No
# additional poller, token reader, or model-selectable destination is created.
_delivery = None


def deliver_proposal(controls, route, operation):
    if route.get('platform') != 'telegram':
        return False
    binding = controls.binding()
    if (route.get('chat_id') != str(binding.telegram_chat)
            or route.get('actor_id') != str(binding.telegram_user)
            or route.get('chat_type') not in ('private', 'dm')):
        return False
    controls.bind_notice(Owner(binding.generation, 'telegram'), operation)
    if _delivery is None:
        return False
    native, loop = _delivery
    if loop.is_closed() or not loop.is_running():
        return False
    # Routing creates a pending card only. Actual Update identity is checked
    # afresh inside callback before any approval can take effect.
    async def send():
        current = await asyncio.to_thread(controls.binding)
        if current != binding:
            return False
        owner = Owner(current.generation, 'telegram')
        row = await asyncio.to_thread(controls.get, owner, operation)
        await _card(native.bot, controls, owner, current.telegram_chat, row)
        return True
    try:
        if asyncio.get_running_loop() is loop:
            return False  # Do not deadlock the native loop from a sync handler.
    except RuntimeError:
        pass
    future = asyncio.run_coroutine_threadsafe(send(), loop)
    try:
        return future.result(timeout=15) is True
    except Exception:
        future.cancel()
        return False  # The saved request remains available through /spark show.


async def _card(bot, controls, owner, chat, row):
    from telegram import InlineKeyboardButton, InlineKeyboardMarkup
    buttons = []
    action = row['intent']['action']
    confirmation = {ERASE_ACTION: 'Erase memory', UPDATE_ACTION: 'Install this version'}.get(action, 'Run it')
    for verb, label in (('confirm', confirmation), ('cancel', 'Cancel'), ('check', 'Check result'),
                        ('accept_update', 'Keep this version'), ('rollback_update', 'Restore previous version')):
        if row.get('can_' + verb):
            buttons.append(InlineKeyboardButton(label, callback_data=f'sparkie:{verb}:{row["id"]}'))
    # Native bot text, with no model/generated HTML or Markdown.
    text = result_text(row)
    if action == UPDATE_ACTION:
        text = row['description'] + '\n\n' + text
        # Send the entire sealed review before issuing an actionable card. At
        # most 2,000 Unicode characters fit even when all use two UTF-16 units.
        while len(text.encode('utf-16-le')) > 2 * 4096:
            end = text.rfind('\n', 0, 2000)
            end = end + 1 if end > 0 else 2000
            await asyncio.to_thread(controls.current, owner)
            await bot.send_message(chat_id=chat, text=text[:end], parse_mode=None)
            text = text[end:]
        await asyncio.to_thread(controls.current, owner)
    message = await bot.send_message(chat_id=chat, text=text,
                                     reply_markup=InlineKeyboardMarkup([buttons]) if buttons else None,
                                     parse_mode=None)
    if buttons:
        current = await asyncio.to_thread(controls.current, owner)
        await asyncio.to_thread(controls.store.bind_telegram_card, current, row['id'],
                                chat=message.chat.id, message=message.message_id)


async def command(update, context):
    try:
        controls = configured()
        binding = await asyncio.to_thread(controls.binding)
        owner = binding.telegram(update)
        message = update.effective_message
        if message is None or update.message is None or update.edited_message is not None:
            raise PermissionError('Send a new request in the paired private chat.')
        args = (message.text or '').split()[1:]
        if args == ['services']:
            catalog = await asyncio.to_thread(controls.service_catalog, owner)
            lines = [row['recipe'] + ' · ' + row['kind'] + ' · ' + ', '.join(row['sparks'])
                     for row in catalog]
            await message.reply_text('\n'.join(lines) if lines else 'No enrolled services are available yet.', parse_mode=None)
            return
        if len(args) == 2 and args[0] == 'open':
            from .service_access import public_link
            await asyncio.to_thread(controls.service_route, owner, recipe=args[1])
            await message.reply_text('Open this service with your Hermes owner sign-in:\n' + public_link(args[1]), parse_mode=None)
            return
        if len(args) == 3 and args[0] == 'logs':
            lines = await asyncio.to_thread(controls.service_logs, owner, recipe=args[1], instance=args[2])
            await message.reply_text(('\n'.join(lines) or 'No runtime log entries are available.')[-3500:], parse_mode=None)
            return
        if args == ['recent']:
            rows = await asyncio.to_thread(controls.recent, owner)
            for row in rows[:5]:
                if row.get('review_available'):
                    await message.reply_text(row['description'] + '\n' + row['message']
                                             + '\nReview this update with /spark show ' + row['id'], parse_mode=None)
                else:
                    await _card(context.bot, controls, owner, update.effective_chat.id, row)
            if not rows:
                await message.reply_text('No Spark change requests yet.')
            return
        if len(args) == 2 and args[0] == 'show' and re.fullmatch('[a-f0-9]{32}', args[1]):
            row = await asyncio.to_thread(controls.get, owner, args[1])
        elif len(args) == 2 and args[0] == 'update':
            reference = f'telegram:update:{update.effective_chat.id}:{message.message_id}'
            row = await asyncio.to_thread(controls.prepare_update, owner, request_key=reference, request_ref=reference,
                                         proposal=args[1])
            await asyncio.to_thread(controls.bind_notice, owner, row['id'])
        elif len(args) == 3 and args[0] in ('run', 'stop-service'):
            catalog = await asyncio.to_thread(controls.service_catalog, owner)
            selected = next((row for row in catalog if row['recipe'] == args[1]), None)
            if selected is None:
                raise ValueError('Choose a recipe listed by /spark services.')
            target = {'action': 'start_service', 'spark': args[2], 'recipe': selected['recipe'],
                      'revision': selected['revision']}
            if args[0] == 'stop-service':
                instance = next((row for row in selected['instances'] if row['instance'] == args[2] and row['held']), None)
                if instance is None:
                    raise ValueError('Choose the exact active service instance.')
                target.update(action='stop_service', spark=instance['spark'], instance=instance['instance'])
            reference = f'telegram:{update.effective_chat.id}:{message.message_id}'
            row = await asyncio.to_thread(controls.prepare, owner, request_key=reference, request_ref=reference, **target)
            await asyncio.to_thread(controls.bind_notice, owner, row['id'])
        elif (len(args) == 2 and args[0] in ('wake', 'sleep')) or (len(args) == 3 and args[0] == 'stop'):
            reference = f'telegram:{update.effective_chat.id}:{message.message_id}'
            row = await asyncio.to_thread(controls.prepare, owner, request_key=reference, request_ref=reference,
                action='stop_workload' if args[0] == 'stop' else args[0], spark=args[1],
                container=args[2] if len(args) == 3 else None)
            await asyncio.to_thread(controls.bind_notice, owner, row['id'])
        else:
            await message.reply_text(HELP)
            return
        await _card(context.bot, controls, owner, update.effective_chat.id, row)
    except (PermissionError, ValueError, RuntimeError) as exc:
        # Never echo the command/identity or a credential-bearing exception from transport.
        if update.effective_message is not None:
            await update.effective_message.reply_text(str(exc))


def _require_default_memory_profile():
    from hermes_constants import get_hermes_home, get_process_hermes_home
    active = get_hermes_home()
    default_profile('default' if active == get_process_hermes_home() and active.parent.name != 'profiles' else 'other')


async def memory_review_command(update, context):
    from telegram.ext import ApplicationHandlerStop
    from .memory_review import decide, proposals
    message = update.effective_message
    try:
        binding = await asyncio.to_thread(configured().binding)
        owner = binding.telegram(update)
        if update.message is None or update.edited_message is not None:
            raise PermissionError('Send a new request in the paired private chat.')
        _require_default_memory_profile()
        words = message.text.split()
        if len(words) == 4 and words[1] in ('approve', 'reject', 'close'):
            result = await asyncio.to_thread(decide, owner, words[2], words[3], action=words[1])
            await message.reply_text('Memory change ' + result['state'] + '.')
        elif len(words) == 1:
            rows = await asyncio.to_thread(proposals, owner)
            if not rows:
                await message.reply_text('No memory changes are waiting.')
            for row in rows:
                fields = [('Target', row['target']), ('Change', row['action'])]
                if 'entry' in row:
                    fields.extend([('Existing entry', row['entry']), ('Find', row['find'])])
                fields.append(('Proposed text', row['content']))
                for label, value in fields:
                    # Separate plain-text messages preserve every character without Telegram markup.
                    text = label + '\n' + value
                    for start in range(0, len(text), 1900):
                        await message.reply_text(text[start:start + 1900], parse_mode=None)
                key = row['id'] + ' ' + row['digest']
                if row['state'] == 'held':
                    found = row['observation']['proposed_entry_present']
                    prior = ' The original entry is still present.' if row['observation']['prior_entry_present'] else ''
                    await message.reply_text('Held request ' + row['id'] + '. Proposed entry currently present: ' + str(found) + '.' + prior +
                                             ' This observation cannot verify the earlier dispatch. Refresh with /memoryreview or close without retry: /memoryreview close ' + key)
                else:
                    await message.reply_text('/memoryreview approve ' + key + '\n/memoryreview reject ' + key)
        else:
            raise ValueError('Use /memoryreview to see the exact change before deciding.')
    except (PermissionError, RuntimeError, ValueError) as exc:
        if message is not None:
            await message.reply_text(str(exc))
    finally:
        raise ApplicationHandlerStop


async def erase_command(update, context):
    from telegram.ext import ApplicationHandlerStop

    message = update.effective_message
    try:
        controls = configured()
        binding = await asyncio.to_thread(controls.binding)
        owner = binding.telegram(update)
        if message is None or update.message is None or update.edited_message is not None:
            raise PermissionError('Send a new request in the paired private chat.')
        _require_default_memory_profile()
        parts = (message.text or '').split(maxsplit=2)
        if len(parts) != 3:
            raise ValueError('Use /memoryerase memory <exact text> or /memoryerase user <exact text>.')
        _, target, literal = parts
        reference = f'telegram:memory:{update.effective_chat.id}:{message.message_id}'
        row = await asyncio.to_thread(controls.prepare_memory, owner, request_key=reference, request_ref=reference,
                                      target=target, literal=literal)
        await _card(context.bot, controls, owner, update.effective_chat.id, row)
    except (PermissionError, ValueError, RuntimeError):
        if message is not None:
            await message.reply_text('The erase request could not be prepared. In the paired private chat, use '
                                     '/memoryerase memory <exact text> or /memoryerase user <exact text>.')
    finally:
        # Consume even if a confirmation card or error reply could not be sent.
        # The normal ingress and observer groups must never receive this text.
        raise ApplicationHandlerStop


async def callback(update, context):
    query = update.callback_query
    try:
        controls = configured()
        binding = await asyncio.to_thread(controls.binding)
        owner = binding.telegram(update)
        match = re.fullmatch(PATTERN, query.data or '')
        if match is None or query.message is None:
            raise PermissionError('Use the confirmation button sent for this request.')
        verb, operation = match.groups()
        current = await asyncio.to_thread(controls.current, owner)
        await asyncio.to_thread(controls.store.require_telegram_card, current, operation,
                                chat=update.effective_chat.id, message=query.message.message_id)
        # Answer promptly, before any potentially slow execution or verification.
        await query.answer('Checking this request…')
        if verb in ('confirm', 'accept_update', 'rollback_update'):
            row = await asyncio.to_thread(controls.get, owner, operation)
            if row['intent']['action'] == UPDATE_ACTION:
                markup = getattr(query.message, 'reply_markup', None)
                if not markup or not any(button.callback_data == query.data
                                         for line in markup.inline_keyboard for button in line):
                    raise PermissionError('Use the update decision shown on this card.')
            if row['intent']['action'] == ERASE_ACTION:
                _require_default_memory_profile()
            row = await asyncio.to_thread(getattr(controls, verb), owner, operation, row['digest'])
        else:
            row = await asyncio.to_thread(getattr(controls, verb), owner, operation)
        await _card(context.bot, controls, owner, update.effective_chat.id, row)
    except (PermissionError, ValueError, RuntimeError) as exc:
        # answer can be called again after an earlier acknowledgement; errors here
        # do not change the durable operation or dispatch a second time.
        await query.answer(str(exc), show_alert=True)


def register(native, adapter):
    global _delivery
    from telegram.ext import CallbackQueryHandler, CommandHandler
    native.add_handler(CommandHandler('memoryreview', memory_review_command, block=True), group=-1)
    native.add_handler(CommandHandler('memoryerase', erase_command, block=True), group=-1)
    native.add_handler(CommandHandler(['spark', 'sparks'], command))
    native.add_handler(CallbackQueryHandler(callback, pattern=PATTERN))
    try:
        _delivery = (native, asyncio.get_running_loop())
    except RuntimeError:
        _delivery = None
