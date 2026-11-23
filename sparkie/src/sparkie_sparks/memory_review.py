"""Review individual native Hermes memory proposals on the bound owner channels."""
import fcntl
import hashlib
import hmac
import json
import re
import secrets
import time
from contextlib import contextmanager
from pathlib import Path

from .authority import Owner
from .controls import configured


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
    if error := _pin_matched_entries(store, payload):
        return error
    payload['sparkie_owner_generation'] = configured().binding().generation
    with _locked() as directory:
        for held in directory.glob('*.held'):
            original = json.loads(held.read_bytes())['payload']
            if _same_intent(original, payload):
                raise RuntimeError('An earlier matching change is held. Review its outcome before proposing it again.')
        row = wa.stage_write(wa.MEMORY, payload, summary=op['action'] + ' ' + payload['target'], origin=wa.current_origin())
        if wa.get_pending(wa.MEMORY, row['id']) != row:
            raise RuntimeError('The memory proposal could not be saved. Nothing was changed.')
    return json.dumps({'success': True, 'staged': True, 'saved': False, 'pending_id': row['id'],
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
def _locked():
    directory = default_home() / 'pending' / 'memory'
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (directory / '.owner-review.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        yield directory


def _observation(view):
    from tools.memory_tool import load_on_disk_store
    from tools.memory_tool_store import _patch_entry
    entries = getattr(load_on_disk_store(), view['target'] + '_entries')
    expected = view['content'].strip()
    if view['action'] == 'patch':
        expected, _, _ = _patch_entry(view['entry'], view['find'], view['content'])
    return {'proposed_entry_present': expected is not None and expected in entries,
            'prior_entry_present': view.get('entry') in entries if 'entry' in view else None}


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
        output = []
        for row, state in rows:
            if not isinstance(row.get('payload'), dict) or row['payload'].get('sparkie_owner_generation') != generation:
                continue
            view = _view(row, generation)
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
        grant = _grant(directory, view, state, issue=False)
        if view['id'] != request or not hmac.compare_digest(grant['digest'], digest):
            raise ValueError('The exact proposal changed. Review it again.')
        _owner(owner)
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
            source.rename(rejected)
            atomic_json_write(final, dict(record, state='rejected'), mode=0o600, fsync_dir=True)
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
        atomic_json_write(final, dict(record, state='saved', observation=observed), mode=0o600, fsync_dir=True)
        held.unlink()
        return {'id': request, 'state': 'saved'}
