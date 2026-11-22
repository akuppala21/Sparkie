"""Typed access to the fixed root steward, inside the existing fleet broker.

The model may propose a sealed candidate. Only the existing verified owner
controls may approve, accept or restore it. No command, path or unit name is
accepted from an RPC caller or model.
"""
import json
from pathlib import Path
import re
import socket
import stat
import struct

ACTION = 'update_application'
SOCKET = '/run/sparkie-update.sock'
REVIEW_FIELDS = {'release', 'previous', 'candidate', 'diff', 'checks', 'interruption', 'rollback'}
LIMIT = 32768


def digest(value):
    if not isinstance(value, str) or not re.fullmatch('[a-f0-9]{64}', value):
        raise ValueError('Select the exact reviewed update identity.')
    return value


def reviewed(value):
    if not isinstance(value, dict) or set(value) != REVIEW_FIELDS:
        raise ValueError('The update review is incomplete.')
    if (not isinstance(value['release'], str)
            or not re.fullmatch('[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}', value['release'])
            or '..' in value['release']):
        raise ValueError('The update has an invalid release name.')
    digest(value['previous']); digest(value['candidate'])
    if value['previous'] == value['candidate']:
        raise ValueError('This candidate is already the reviewed previous release.')
    for name in ('diff', 'checks', 'interruption', 'rollback'):
        text = value[name]
        if (not isinstance(text, str) or not text.strip() or len(text) > 4000 or len(text.encode()) > 8192
                or any(ord(char) < 32 and char != '\n' for char in text)):
            raise ValueError('The update needs a bounded diff, checks, interruption and recovery review.')
    if len(json.dumps(value, ensure_ascii=False).encode()) > 24 * 1024 - 1024:
        raise ValueError('The update review is too large.')
    return dict(value)


def update_intent(proposal, review):
    return {'action': ACTION, 'spark': 'spark1', 'proposal': digest(proposal), 'review': reviewed(review)}


class StewardClient:
    def __init__(self, path=SOCKET):
        # A nondefault path is useful for private transport fixtures. Production
        # composition constructs the fixed default; request bodies cannot set it.
        self.path = Path(path)

    def __call__(self, method, proposal, operation=None):
        if method not in ('inspect', 'apply', 'observe', 'accept', 'rollback'):
            raise ValueError('Unsupported update request.')
        request = {'method': method, 'proposal': digest(proposal)}
        if method != 'inspect':
            if not isinstance(operation, str) or not re.fullmatch('[a-f0-9]{32}', operation):
                raise ValueError('Use the original update request.')
            request['operation'] = operation
        try:
            entry = self.path.lstat()
            if not stat.S_ISSOCK(entry.st_mode) or entry.st_uid != 0 or entry.st_mode & 0o007:
                raise RuntimeError('The protected update connection is unavailable.')
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
                connection.settimeout(10)
                connection.connect(str(self.path))
                _, uid, _ = struct.unpack('3i', connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
                if uid != 0:
                    raise RuntimeError('The update connection has an unexpected owner.')
                connection.sendall(json.dumps(request, separators=(',', ':')).encode() + b'\n')
                with connection.makefile('rb') as stream:
                    raw = stream.readline(LIMIT + 1)
                if len(raw) > LIMIT or not raw.endswith(b'\n'):
                    raise RuntimeError('The update response was incomplete.')
                response = json.loads(raw)
        except (OSError, ValueError):
            raise RuntimeError('The update connection did not return a verified response. Check the same request before retrying.') from None
        if not isinstance(response, dict) or response.get('ok') is not True:
            raise RuntimeError('The update steward refused this request. Nothing new is authorized.')
        return response


class ApplicationUpdates:
    def __init__(self, store, *, client=None):
        self.store = store
        self.client = client if client is not None else StewardClient()

    def review(self, proposal):
        return reviewed(self.client('inspect', digest(proposal)).get('review'))

    def dispatch(self, operation, target):
        from .operations import NotDispatched
        if target != update_intent(target.get('proposal'), target.get('review')):
            raise NotDispatched('The approved update changed.')
        # Reinspect before dispatch. The steward independently verifies the
        # durable approval, predecessor, archive and live owner generation.
        if self.review(target['proposal']) != target['review']:
            raise NotDispatched('The update review changed. Prepare a new request.')
        self.client('apply', target['proposal'], operation)

    def status(self, operation, target):
        row = self.client('observe', target['proposal'], operation)
        state = row.get('state')
        if state not in ('running', 'awaiting_owner_check', 'succeeded', 'failed', 'rolled_back', 'unknown'):
            raise RuntimeError('The update result is not verified.')
        messages = {
            'running': 'The approved update is being installed. Keep this request.',
            'awaiting_owner_check': 'Installed and basic health checks passed. Check the changed behavior, then keep this version or restore the previous release.',
            'succeeded': 'You accepted the installed version after checking it.',
            'failed': 'The update failed. Read its recovery result before another update.',
            'rolled_back': 'The previous release was restored. New conversations and electricity history were preserved.',
            'unknown': 'The update result is not known. Check this same request; do not install it again.',
        }
        return {'state': state, 'message': messages[state], 'rollback_available': row.get('rollback_available') is True,
                'accept_available': row.get('accept_available') is True}

    def observe(self, operation, target):
        state = self.status(operation, target)['state']
        return ('succeeded' if state == 'succeeded' else 'failed'
                if state in ('failed', 'rolled_back') else 'unknown')

    def accept(self, operation, target):
        self.client('accept', target['proposal'], operation)

    def rollback(self, operation, target):
        self.client('rollback', target['proposal'], operation)


def describe(target):
    review = target['review']
    return ('Update Sparkie to ' + review['release'] + '.\nCandidate: ' + review['candidate']
            + '\nPrevious: ' + review['previous'] + '\nProposal: ' + target['proposal']
            + '\nChanges: ' + review['diff'] + '\nChecks: ' + review['checks']
            + '\nInterruption: ' + review['interruption'] + '\nRecovery: ' + review['rollback'])
