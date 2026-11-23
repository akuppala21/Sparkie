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
JSON_FIELDS = re.compile(r'\bjson\b\s*(?:(?:with|containing)\s+)?(?:(?:the|these)\s+)?(?:(?:fields|keys)\s*)?[:{(]?\s*(.+?)\s*[.})]*\s*$', re.I | re.S)


@dataclass(frozen=True)
class Checked:
    operation: str
    text: str
    final: bool
    can_finish: bool
    stop_receipt: dict | None


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
            stop_receipt = None
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
                if args.get('reply_format') == 'stop_receipt_json' and row.get('intent', {}).get('action') == 'stop_workload':
                    stop_receipt = body.get('stop_receipt')
            elif body['available'] is False:
                text = 'Could not verify the result of request ' + operation + '. Keep the original request. No change was sent.'
            else:
                return result
        except (ValueError, KeyError, TypeError, AttributeError):
            return result
        key = (session_id, turn_id)
        with self.lock:
            checks = self.turns.setdefault(key, {})
            checks[tool_call_id] = Checked(operation, text, args.get('final_reply') is True or stop_receipt is not None,
                                           can_finish, stop_receipt)
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
        if not isinstance(user, str):
            return next_call()
        for payload in (request, request.get('extra_body') or {}):
            if payload.get('response_format') not in (None, {'type': 'text'}):
                return next_call()
        try:
            only_reads = _only_request_reads(rows)
        except (ValueError, KeyError, TypeError, AttributeError):
            only_reads = False
        if not only_reads:
            return next_call()
        receipts = {checks[row['tool_call_id']].operation: checks[row['tool_call_id']]
                    for row in rows if row.get('role') == 'tool' and row.get('tool_call_id') in checks}
        requested = set(OPERATION.findall(user))
        if not requested.issubset(receipts):
            return next_call()
        if re.search(r'\bjson\b', user, re.IGNORECASE):
            # Only honor the named single-receipt option for the owner's exact
            # field list. Other shapes, additional records and native schemas
            # keep their normal model round and the typed tool result.
            if len(receipts) != 1 or requested != receipts.keys():
                return next_call()
            item = next(iter(receipts.values()))
            fields = JSON_FIELDS.search(user)
            if not item.stop_receipt or not fields:
                return next_call()
            names = re.findall(r'\w+', fields[1])
            if {name for name in names if name.lower() != 'and'} != item.stop_receipt.keys():
                return next_call()
            content = json.dumps(item.stop_receipt)
        else:
            if not all(item.can_finish for item in receipts.values()) or any(item.stop_receipt for item in receipts.values()):
                return next_call()
            content = '\n\n'.join(item.text for item in receipts.values())
        from openai.types.chat import ChatCompletion
        return ChatCompletion(id='spark-check-' + turn_id, object='chat.completion', created=int(time.time()),
                              model=model, choices=[{'index': 0, 'finish_reason': 'stop',
                                                     'message': {'role': 'assistant', 'content': content}}])


def register(ctx):
    replies = RecoveryReplies()
    ctx.register_middleware('tool_execution', replies.checked)
    ctx.register_middleware('llm_execution', replies.reply)
    ctx.register_hook('post_llm_call', replies.clear)
