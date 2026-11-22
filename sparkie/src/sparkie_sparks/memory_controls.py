"""Owner-confirmed erasure and correction feedback for native Hermes memory."""

import json

ERASE_ACTION = 'erase_memory'
ERASE_LIMITS = ('Start a fresh conversation after erasing. Earlier open conversations can hold a cached copy. '
                'Telegram history, exports, backups and external records require separate deletion.')


def guard(tool_name, args, **_):
    """Keep native additions and corrections available to the agent."""
    if tool_name != 'memory' or not isinstance(args, dict):
        return

    def deletes(operation):
        if not isinstance(operation, dict):
            return False
        content = operation.get('content') or operation.get('new_text')
        action = operation.get('action')
        return (action == 'remove' or
                (action in ('patch', 'replace') and (not isinstance(content, str) or not content.strip())))

    batch = args.get('operations')
    if deletes(args) or isinstance(batch, list) and any(deletes(op) for op in batch):
        return {'action': 'block', 'message': (
            'Erasing memory requires a separate owner confirmation. Use Erase memory on Home '
            'or /memoryerase in the paired Telegram chat. Ordinary nonempty memory corrections are available.')}


def default_profile(profile):
    if profile not in ('', 'default'):
        raise ValueError('Open the default Hermes profile before requesting a memory erase.')


def correction_feedback(tool_name, args, result, **_):
    """Keep the native patch failure and point back to the entry's original header."""
    if tool_name != 'memory' or not isinstance(args, dict) or not isinstance(result, str):
        return
    target = args.get('target')
    if target not in ('user', 'memory'):
        return
    operation = args
    prefix = ''
    if 'operations' in args:
        operations = args['operations']
        if not isinstance(operations, list) or len(operations) != 1:
            return
        operation = operations[0]
        prefix = 'Operation 1 (patch): '
    if not isinstance(operation, dict) or operation.get('action') != 'patch':
        return
    old = operation.get('old_text')
    new = operation.get('content') or operation.get('new_text')
    if not all(isinstance(value, str) and value.strip() for value in (old, new)):
        return
    try:
        payload = json.loads(result)
    except ValueError:
        return
    if not isinstance(payload, dict) or payload.get('success') is not False or payload.get('done'):
        return
    error = payload.get('error')
    if not isinstance(error, str) or not error.startswith(f"{prefix}No entry matched '{old}'."):
        return
    alternate = 'user' if target == 'memory' else 'memory'
    payload['correction_hint'] = (
        f"Check the native memory headers. If the original entry appears under {alternate.upper()}.md, "
        f"retry the patch with top-level target '{alternate}' and old_text copied from that entry. "
        "Keep the correction in its original entry. Adding a competing value leaves the old one active.")
    return json.dumps(payload, ensure_ascii=False)


def describe(plan):
    label = 'assistant memory' if plan['target'] == 'memory' else 'user preferences'
    return (f"Permanently erase the exact text you entered from {label} and its searchable copies in the default profile. "
            f"This affects {plan['memory_entries']} memory entry, {plan['message_rows']} searchable messages "
            f"and {plan['session_rows']} session records. {ERASE_LIMITS}")
