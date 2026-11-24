"""Review individual native Hermes memory proposals on the bound owner channels."""
import fcntl
import hashlib
import hmac
import json
import re
import secrets
import time
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path

from .authority import Owner
from .controls import configured


# Set only by the owner transport and the native tool execution middleware.
_owner_turn = ContextVar('sparkie_owner_turn', default=None)
_tool_wait = ContextVar('sparkie_memory_tool_wait', default=None)
WAIT_SECONDS = 120
POLL_SECONDS = 0.15


@contextmanager
def owner_memory_turn(session_id, *, on_pending=None, cancelled=None, on_outcome=None, matches_owner=None):
    token = _owner_turn.set((session_id, on_pending, cancelled, on_outcome, matches_owner))
    try:
        yield
    finally:
        _owner_turn.reset(token)


@contextmanager
def chat_memory_wait(session_id, turn_id, tool_call_id, *, on_pending=None, cancelled=None):
    if not all(isinstance(key, str) and key for key in (session_id, turn_id, tool_call_id)):
        raise ValueError('Missing originating chat or tool call.')
    token = _tool_wait.set(((session_id, turn_id, tool_call_id), on_pending, cancelled))
    try:
        yield
    finally:
        _tool_wait.reset(token)


def memory_execution(tool_name, next_call, session_id='', turn_id='', tool_call_id='', **kwargs):
    scope = _owner_turn.get()
    if tool_name != 'memory' or not scope or session_id != scope[0]:
        return next_call()
    if not all(isinstance(key, str) and key for key in (session_id, turn_id, tool_call_id)):
        raw = _receipt('interrupted')
    else:
        with chat_memory_wait(session_id, turn_id, tool_call_id, on_pending=scope[1], cancelled=scope[2]):
            raw = next_call()
    if scope[3]:
        try:
            receipt = json.loads(raw)
            if isinstance(receipt, dict) and 'saved' in receipt and 'state' in receipt:
                scope[3](receipt)
        except Exception:
            # Delivery failure cannot revise the decision or dispatch the tool again.
            pass
    return raw


def _receipt(state, request=None, observation=None):
    messages = {
        'saved': 'The owner approved this exact change and the native memory store verified it.',
        'rejected': 'The owner rejected this change.',
        'held': 'The outcome is uncertain. Check the held proposal before taking further action.',
        'closed_without_retry': 'The owner closed the uncertain change without retrying it.',
        'timed_out': 'The chat stopped waiting. A staged proposal remains available in Memory changes until the owner decides.',
        'interrupted': 'The chat wait was interrupted. Check Memory changes for the current outcome before proposing this again.',
        'enrollment_changed': 'The owner enrollment changed while waiting.',
        'owner_unverified': 'Owner verification is unavailable for this memory change. Nothing was staged or saved.',
    }
    receipt = dict(success=state == 'saved', saved=state == 'saved', state=state,
                           pending_id=request, message=messages[state],
                   instruction='Use this checked memory outcome. Include the answer to the owner’s other requests in your final reply; preliminary prose was withheld.')
    if state == 'timed_out' and request is None:
        receipt['message'] = 'The proposal store stayed busy. This call did not stage a memory change.'
    if observation is not None:
        receipt['observation'] = observation
    return json.dumps(receipt)


def _read_decision(directory, request, digest, generation):
    final = directory / (request + '.decision')
    if not final.is_file():
        return None
    record = json.loads(final.read_bytes())
    action = {'held': 'approve', 'saved': 'approve', 'rejected': 'reject',
              'closed_without_retry': 'close'}.get(record.get('state'))
    if (not action or record.get('action') != action or record.get('id') != request
            or record.get('owner_generation') != generation or record.get('content_hash') != digest
            or record.get('channel') not in ('web', 'telegram')):
        raise ValueError('The decision does not match this exact memory proposal.')
    return record


def _retired(directory, row, path):
    """Retire a crash-leftover native marker only after matching the durable terminal decision."""
    generation = row['payload']['sparkie_owner_generation']
    view = _view(row, generation)
    record = _read_decision(directory, view['id'], view['digest'], generation)
    if record and record['state'] != 'held':
        if path.parent != directory or path.stem != view['id']:
            raise ValueError('The memory proposal file does not match its decision.')
        path.unlink(missing_ok=True)
        return True
    return False


def _decision(directory, request, digest, generation, check):
    record = _read_decision(directory, request, digest, generation)
    if record is None:
        # Older releases can have stopped between an authenticated rejection's
        # exclusive rename and its audit write. The retired row proves rejection,
        # but cannot reconstruct which owner channel made it.
        retired = directory / (request + '.rejected')
        if retired.is_file():
            view = _view(json.loads(retired.read_bytes()), generation)
            if view['id'] == request and view['digest'] == digest:
                return _receipt('rejected', request)
            return _receipt('interrupted', request)
        if (directory / (request + '.held')).exists():
            return _receipt('held', request)
        return None
    state = record['state']
    if state == 'saved':
        observed = _read_fingerprints(check)
        if (record.get('observation') != observed or not observed['proposed_entry_present']
                or observed['prior_entry_present']):
            return _receipt('held', request)
        return _receipt(state, request, observed)
    return _receipt(state, request)


def _await_decision(directory, view, generation, scope, deadline):
    request = view['id']
    try:
        if scope[1]:
            scope[1](request)
        check = _entry_check(view)
        next_enrollment_check = time.monotonic() + 2
        while True:
            if time.monotonic() >= next_enrollment_check:
                if configured().binding().generation != generation:
                    return _receipt('enrollment_changed', request)
                next_enrollment_check = time.monotonic() + 2
            if scope[2] and scope[2]():
                return _receipt('interrupted', request)
            try:
                with _locked(fcntl.LOCK_SH | fcntl.LOCK_NB):
                    result = _decision(directory, request, view['digest'], generation, check)
                    if result is not None:
                        if configured().binding().generation != generation:
                            return _receipt('enrollment_changed', request)
                        return result
            except BlockingIOError:
                pass
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                if configured().binding().generation != generation:
                    return _receipt('enrollment_changed', request)
                return _receipt('timed_out', request)
            time.sleep(min(POLL_SECONDS, remaining))
    except Exception:
        return _receipt('interrupted', request)


def _recover_wait(directory, reservation, generation, intent):
    saved = json.loads(reservation.read_bytes())
    if saved.get('generation') != generation:
        return _receipt('enrollment_changed')
    if saved.get('intent') != intent:
        return _receipt('interrupted')
    if 'id' not in saved:
        # A process can stop after native staging and before recording its ID.
        from tools import write_approval as wa
        for row in wa.list_pending(wa.MEMORY):
            if row['payload'].get('sparkie_wait_origin') == reservation.stem:
                view = _view(row, generation)
                return _receipt('interrupted', view['id'])
        return _receipt('interrupted')
    return (_decision(directory, saved['id'], saved['digest'], generation, saved['entry_check'])
            or _receipt('interrupted', saved['id']))


def default_home():
    from hermes_constants import get_hermes_home, get_process_hermes_home
    home = Path(get_hermes_home())
    if home != Path(get_process_hermes_home()) or home.parent.name == 'profiles':
        raise PermissionError('Open the default profile to review memory changes.')
    return home


def _operation(payload):
    if payload.get('target') not in ('memory', 'user'):
        raise ValueError('Choose assistant memory or user preferences.')
    if payload.get('action') == 'batch':
        items = payload.get('operations')
        if not isinstance(items, list) or len(items) != 1:
            raise ValueError('Propose each memory change separately so the owner can confirm it.')
        op = items[0]
    else:
        op = payload
    if not isinstance(op, dict) or op.get('action') not in ('add', 'patch') or not isinstance(op.get('content'), str) or not op['content'].strip():
        raise ValueError('Use the separate owner-confirmed erasure control to remove memory.')
    return op


def propose(store, payload):
    """The checked native memory-tool branch never authorizes or applies a write."""
    from tools import write_approval as wa
    from tools.memory_tool import _pin_matched_entries
    default_home()
    # The native schema accepts new_text as a synonym for content.
    for item in payload.get('operations', [payload]):
        if isinstance(item, dict) and not item.get('content') and item.get('new_text'):
            item['content'] = item['new_text']
    op = _operation(payload)
    # Look up the owner only when an actual write needs it. Chat transport and
    # ordinary tools work independently of the private fleet control socket.
    try:
        binding = configured().binding()
    except (RuntimeError, OSError, ValueError, TypeError, KeyError):
        return _receipt('owner_unverified')
    turn = _owner_turn.get()
    if turn and turn[4] is not None and not turn[4](binding):
        return _receipt('owner_unverified')
    generation = binding.generation
    payload['sparkie_owner_generation'] = generation
    scope = _tool_wait.get()
    deadline = time.monotonic() + WAIT_SECONDS
    with _locked(deadline=deadline if scope else None) as directory:
        if directory is None:
            return _receipt('timed_out')
        if scope:
            from utils.files import atomic_json_write
            origin = json.dumps(scope[0], ensure_ascii=True).encode()
            reservation = directory / (hashlib.sha256(origin).hexdigest() + '.wait')
            intent = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
            if reservation.exists():
                return _recover_wait(directory, reservation, generation, intent)
            payload['sparkie_wait_origin'] = reservation.stem
        if error := _pin_matched_entries(store, payload):
            return error
        for held in directory.glob('*.held'):
            held_row = json.loads(held.read_bytes())
            original = held_row['payload']
            if _same_intent(original, payload) and not _retired(directory, held_row, held):
                raise RuntimeError('An earlier matching change is held. Review its outcome before proposing it again.')
        if scope:
            atomic_json_write(reservation, {'generation': generation, 'intent': intent}, mode=0o600, fsync_dir=True)
        row = wa.stage_write(wa.MEMORY, payload, summary=op['action'] + ' ' + payload['target'], origin=wa.current_origin())
        if wa.get_pending(wa.MEMORY, row['id']) != row:
            raise RuntimeError('The memory proposal could not be saved. Nothing was changed.')
        if scope:
            view = _view(row, generation)
            atomic_json_write(reservation, {'generation': generation, 'intent': intent, 'id': view['id'],
                                            'digest': view['digest'], 'entry_check': _entry_check(view)}, mode=0o600, fsync_dir=True)
    if scope:
        return _await_decision(directory, view, generation, scope, deadline)
    return json.dumps({'status': 'pending_approval', 'success': True, 'staged': True, 'saved': False, 'pending_id': row['id'],
                       'message': 'Awaiting owner confirmation. Open Memory changes on Home or send /memoryreview in the paired Telegram chat. This change has not been saved to memory.'})


def _view(row, generation):
    payload = row['payload']
    if row.get('subsystem') != 'memory' or payload.get('sparkie_owner_generation') != generation:
        raise PermissionError('This proposal belongs to a different owner enrollment.')
    op = _operation(payload)
    request = row['id']
    if not isinstance(request, str) or not re.fullmatch(r'[a-f0-9]{32}', request):
        raise ValueError('Invalid memory proposal ID.')
    encoded = json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()
    item = {'id': request, 'digest': hashlib.sha256(encoded).hexdigest(),
            'target': payload['target'], 'action': op['action'], 'content': op['content']}
    if op['action'] == 'patch':
        if not isinstance(op.get('matched_entry'), str) or not isinstance(op.get('old_text'), str):
            raise ValueError('The prior entry is unavailable. Request a fresh proposal.')
        item['entry'] = op['matched_entry']
        item['find'] = op['old_text']
    return item


def _owner(owner):
    default_home()
    if not isinstance(owner, Owner) or owner.channel not in ('web', 'telegram') or configured().binding().generation != owner.generation:
        raise PermissionError('Sign in as the current owner or use the paired private Telegram chat.')
    return owner.generation


def _same_intent(first, second):
    a, b = _operation(first), _operation(second)
    return first['target'] == second['target'] and all(a.get(key) == b.get(key) for key in ('action', 'content', 'old_text'))


@contextmanager
def _locked(flags=fcntl.LOCK_EX, *, deadline=None):
    directory = default_home() / 'pending' / 'memory'
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (directory / '.owner-review.lock').open('a') as lock:
        if deadline is None:
            fcntl.flock(lock, flags)
        else:
            while True:
                try:
                    fcntl.flock(lock, flags | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        yield None
                        return
                    time.sleep(min(POLL_SECONDS, remaining))
        yield directory


def _entry_fingerprint(text):
    return hashlib.sha256(text.encode()).hexdigest() if text is not None else None


def _entry_check(view):
    from tools.memory_tool_store import _patch_entry
    expected = view['content'].strip()
    if view['action'] == 'patch':
        expected, _, _ = _patch_entry(view['entry'], view['find'], view['content'])
    return dict(target=view['target'], expected=_entry_fingerprint(expected),
                prior=_entry_fingerprint(view.get('entry')))


def _read_fingerprints(check):
    from tools.memory_tool import load_on_disk_store
    if check['target'] not in ('memory', 'user'):
        raise ValueError('Unknown memory target.')
    entries = getattr(load_on_disk_store(), check['target'] + '_entries')
    fingerprints = {_entry_fingerprint(entry) for entry in entries}
    return {'proposed_entry_present': check['expected'] in fingerprints,
            'prior_entry_present': check['prior'] in fingerprints if check['prior'] is not None else None}


def _observation(view):
    return _read_fingerprints(_entry_check(view))


def _grant(directory, view, state, *, issue):
    from utils.files import atomic_json_write
    path = directory / (view['id'] + '.review')
    grant = json.loads(path.read_bytes()) if path.is_file() else {}
    active = (grant.get('content_hash') == view['digest'] and grant.get('state') == state
              and time.time() < grant.get('expires', 0))
    if not active:
        if not issue:
            raise ValueError('This review expired or the request changed. Review the same request again.')
        grant = {'content_hash': view['digest'], 'state': state, 'digest': secrets.token_hex(32),
                 'expires': time.time() + 300}
        atomic_json_write(path, grant, mode=0o600, fsync_dir=True)
    return grant


def proposals(owner):
    from tools import write_approval as wa
    generation = _owner(owner)
    with _locked() as directory:
        rows = [(row, 'pending') for row in wa.list_pending(wa.MEMORY)]
        rows += [(json.loads(path.read_bytes()), 'held') for path in directory.glob('*.held')]
        for path in directory.glob('*.rejected'):
            retired_row = json.loads(path.read_bytes())
            if retired_row['payload'].get('sparkie_owner_generation') == generation:
                _retired(directory, retired_row, path)
        output = []
        for row, state in rows:
            if not isinstance(row.get('payload'), dict) or row['payload'].get('sparkie_owner_generation') != generation:
                continue
            view = _view(row, generation)
            path = directory / (view['id'] + ('.held' if state == 'held' else '.json'))
            if _retired(directory, row, path):
                continue
            grant = _grant(directory, view, state, issue=True)
            view.update(digest=grant['digest'], expires=grant['expires'], state=state)
            if state == 'held':
                view['observation'] = _observation(view)
            output.append(view)
        return output


def decide(owner, request, digest, *, action):
    """A claimed write can be observed or closed by its owner, and never dispatched again."""
    from tools import write_approval as wa
    from tools.memory_tool import apply_memory_pending, load_on_disk_store
    from utils.files import atomic_json_write
    generation = _owner(owner)
    if not re.fullmatch(r'[a-f0-9]{32}', request) or not re.fullmatch(r'[a-f0-9]{64}', digest):
        raise ValueError('Use the exact request and review digest.')
    with _locked() as directory:
        held = directory / (request + '.held')
        row = json.loads(held.read_bytes()) if held.is_file() else wa.get_pending(wa.MEMORY, request)
        if row is None:
            raise ValueError('This memory proposal is no longer pending.')
        state = 'held' if held.is_file() else 'pending'
        view = _view(row, generation)
        record = _read_decision(directory, request, view['digest'], generation)
        if record and record['state'] != 'held':
            raise ValueError('This memory proposal has already been decided.')
        grant = _grant(directory, view, state, issue=False)
        if view['id'] != request or not hmac.compare_digest(grant['digest'], digest):
            raise ValueError('The exact proposal changed. Review it again.')
        _owner(owner)
        origin = row['payload'].get('sparkie_wait_origin')
        if origin and re.fullmatch('[0-9a-f]{64}', origin):
            # Complete an interrupted staging transaction before consuming the native row.
            reservation = directory / (origin + '.wait')
            saved = json.loads(reservation.read_bytes())
            if 'id' not in saved:
                atomic_json_write(reservation, dict(saved, id=request, digest=view['digest'], entry_check=_entry_check(view)), mode=0o600, fsync_dir=True)
        source = directory / (request + '.json')
        final = directory / (request + '.decision')
        record = {'id': request, 'content_hash': view['digest'], 'owner_generation': generation,
                  'channel': owner.channel, 'review_digest': digest, 'time': time.time(), 'action': action}
        if state == 'held' and action == 'close':
            atomic_json_write(final, dict(record, state='closed_without_retry', observation=_observation(view)), mode=0o600, fsync_dir=True)
            held.unlink()
            return {'id': request, 'state': 'closed_without_retry'}
        if state != 'pending' or action not in ('approve', 'reject'):
            raise ValueError('A held request can only be checked and closed without retry.')
        if action == 'reject':
            rejected = directory / (request + '.rejected')
            atomic_json_write(final, dict(record, state='rejected'), mode=0o600, fsync_dir=True)
            source.rename(rejected)
            rejected.unlink()
            return {'id': request, 'state': 'rejected'}
        # Rename before any possible native dispatch. A later caller cannot replay this ID.
        source.rename(held)
        atomic_json_write(final, dict(record, state='held'), mode=0o600, fsync_dir=True)
        try:
            result = apply_memory_pending(row['payload'], load_on_disk_store())
            observed = _observation(view)
        except Exception as exc:
            raise RuntimeError('The memory outcome is uncertain. Check the same held request.') from exc
        if not result.get('success') or not observed['proposed_entry_present']:
            raise ValueError('The native store did not verify this change. Check the same held request.')
        if observed['prior_entry_present']:
            raise ValueError('The original memory entry is still present alongside the proposed correction. Check the same held request.')
        atomic_json_write(final, dict(record, state='saved', observation=observed), mode=0o600, fsync_dir=True)
        held.unlink()
        return {'id': request, 'state': 'saved'}
