"""Finish an explicitly requested operation-only reply from the actual checked results."""
from collections import OrderedDict
from dataclasses import dataclass
import json
import re
from threading import Lock
import time

from .controls import result_text


OPERATION = re.compile(r'(?<![a-zA-Z0-9])[a-f0-9]{32}(?![a-zA-Z0-9])')
READ_TOOLS = {'tool_search', 'tool_describe', 'spark_change_status', 'spark_check_change'}


@dataclass(frozen=True)
class Checked:
    operation: str
    text: str
    final: bool
    can_finish: bool


def _turn_rows(messages):
    for index in range(len(messages) - 1, -1, -1):
        if messages[index].get('role') == 'user':
            return messages[index:]
    return []


def _only_request_reads(rows):
    """Inspect native calls, including calls deferred behind Hermes Tool Search."""
    from tools.tool_search import normalize_tool_call_entries
    for row in rows:
        for call in row.get('tool_calls') or ():
            function = call['function']
            name = function['name']
            if name == 'tool_call':
                entries, error = normalize_tool_call_entries(json.loads(function['arguments']))
                if error or any(entry['name'] not in READ_TOOLS for entry in entries):
                    return False
            elif name not in READ_TOOLS:
                return False
    return True


class RecoveryReplies:
    """Ephemeral receipts local to one plugin profile. Never use replayed tool text as a receipt."""
    def __init__(self):
        self.lock = Lock()
        self.turns = OrderedDict()

    def checked(self, tool_name, args, next_call, session_id='', turn_id='', tool_call_id=''):
        result = next_call()
        if tool_name != 'spark_check_change' or not (session_id and turn_id and tool_call_id):
            return result
        operation = args.get('operation')
        if not isinstance(operation, str) or not OPERATION.fullmatch(operation):
            return result
        try:
            body = json.loads(result)
            if body['change_dispatched'] is not False:
                return result
            can_finish = False
            if body['available'] is True:
                row = body['request']
                if row['id'] != operation:
                    return result
                text = 'Recorded state: ' + row['state'] + '\n' + result_text(row)
                if row['state'] == 'succeeded':
                    text += '\nThis check establishes the observed result only. It does not diagnose an interruption.'
                # A failed or unsent attempt can require a fresh state review
                # and draft. Preserve that work even if the model asked to finish.
                can_finish = row['state'] in ('uncertain', 'dispatching', 'succeeded')
            elif body['available'] is False:
                text = 'Could not verify the result of request ' + operation + '. Keep the original request. No change was sent.'
            else:
                return result
        except (ValueError, KeyError, TypeError, AttributeError):
            return result
        key = (session_id, turn_id)
        with self.lock:
            checks = self.turns.setdefault(key, {})
            checks[tool_call_id] = Checked(operation, text, args.get('final_reply') is True, can_finish)
            self.turns.move_to_end(key)
            if len(self.turns) > 128:
                self.turns.popitem(last=False)
        return result

    def clear(self, session_id, turn_id='', **_):
        with self.lock:
            self.turns.pop((session_id, turn_id), None)

    def reply(self, request, next_call, session_id='', turn_id='', api_mode='', model='', platform=''):
        key = (session_id, turn_id)
        with self.lock:
            checks = self.turns.get(key, {}).copy()
        # The pinned OpenAI-compatible SSE writer omits a non-streamed final after
        # an earlier tool preamble. Its own provider stream must finish the answer.
        if platform not in ('cli', 'telegram') or api_mode != 'chat_completions' or not any(item.final for item in checks.values()):
            return next_call()
        rows = _turn_rows(request.get('messages') or [])
        trailing = set()
        for row in reversed(rows):
            if row.get('role') != 'tool':
                break
            trailing.add(row.get('tool_call_id'))
        if not trailing.issubset(checks) or not any(call in trailing and item.final for call, item in checks.items()):
            return next_call()
        # A later correction, parallel work or another listed operation must not be lost.
        # A mixed natural-language request with no second tool still relies on the model
        # leaving final_reply off. The option is not an intent classifier.
        user = rows[0].get('content')
        try:
            only_reads = _only_request_reads(rows)
        except (ValueError, KeyError, TypeError, AttributeError):
            only_reads = False
        if not isinstance(user, str) or not only_reads:
            return next_call()
        receipts = {checks[row['tool_call_id']].operation: checks[row['tool_call_id']]
                    for row in rows if row.get('role') == 'tool' and row.get('tool_call_id') in checks}
        if not set(OPERATION.findall(user)).issubset(receipts) or not all(item.can_finish for item in receipts.values()):
            return next_call()
        from openai.types.chat import ChatCompletion
        return ChatCompletion(id='spark-check-' + turn_id, object='chat.completion', created=int(time.time()),
                              model=model, choices=[{'index': 0, 'finish_reason': 'stop',
                                                     'message': {'role': 'assistant', 'content': '\n\n'.join(item.text for item in receipts.values())}}])


def register(ctx):
    replies = RecoveryReplies()
    ctx.register_middleware('tool_execution', replies.checked)
    ctx.register_middleware('llm_execution', replies.reply)
    ctx.register_hook('post_llm_call', replies.clear)
