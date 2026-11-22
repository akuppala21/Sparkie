"""Durable fleet operation receipts, not a task engine or scheduler.

Called only inside the private execution boundary. Native Hermes owns the task;
this module remembers whether a specific fleet change was sent and observed.
Transport identity, real dispatch and verification are injected by trusted code.
No SSH command, root helper or power-switch method is exposed here.
"""

from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import time
import uuid

from .authority import Owner
from .memory_controls import ERASE_ACTION

TERMINAL = frozenset({'succeeded', 'failed', 'cancelled'})
_NO_APPROVAL = object()


class NotDispatched(Exception):
    """Trusted adapter refused before sending any change; never raise after a send."""

SCHEMA = '''
CREATE TABLE operations (
 id TEXT PRIMARY KEY, request_key TEXT UNIQUE NOT NULL, intent TEXT NOT NULL,
 digest TEXT NOT NULL, request_ref TEXT NOT NULL, generation TEXT NOT NULL,
 channel TEXT NOT NULL, state TEXT NOT NULL, expires REAL NOT NULL,
 created REAL NOT NULL, updated REAL NOT NULL, outcome TEXT,
 approved_at REAL, approved_channel TEXT,
 cancel_requested INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE claims (spark TEXT PRIMARY KEY, operation TEXT UNIQUE NOT NULL);
CREATE TABLE telegram_cards (
 operation TEXT NOT NULL, chat INTEGER NOT NULL, message INTEGER NOT NULL,
 PRIMARY KEY (operation, chat, message)
);
PRAGMA user_version=2;
'''


def _stops_uncertain_start(db, owner, target):
    if target.get('action') != 'stop_service':
        return False
    # Only a newly confirmed stop of the originally claimed instance may
    # acquire its resource. The original launch has returned from dispatch
    # and an observation has already recorded its outcome as unknown.
    row = db.execute('SELECT o.* FROM claims c JOIN operations o ON o.id=c.operation '
                     'WHERE c.spark=? AND c.operation=?', (target['spark'], target['instance'])).fetchone()
    if (not row or row['generation'] != owner.generation or row['state'] != 'uncertain'
            or json.loads(row['intent']) != {**{k:target[k] for k in ('spark','recipe','revision')},
                                             'action':'start_service'}):
        return False
    if not db.execute("SELECT 1 FROM sqlite_master WHERE name='recipe_service_instances' AND type='table'").fetchone():
        return False
    return bool(db.execute('SELECT 1 FROM recipe_service_instances WHERE id=? AND name=? AND revision=? '
                           "AND spark=? AND held=1 AND phase='starting' AND workload IS NOT NULL",
                           (target['instance'],target['recipe'],target['revision'],target['spark'])).fetchone())


def _text(value, maximum=128):
    if not isinstance(value, str) or not 1 <= len(value) <= maximum or any(ord(c) < 32 for c in value):
        raise ValueError('Use a bounded request reference without control characters.')
    return value


def intent(action, spark, *, container=None, recipe=None, revision=None, instance=None):
    if action in ('start_service', 'stop_service'):
        from .recipe_services import service_intent
        if container is not None:
            raise ValueError('Select the enrolled recipe and exact service instance.')
        return service_intent(action, spark, recipe, revision, instance)
    if any(field is not None for field in (recipe, revision, instance)):
        raise ValueError('This fleet operation does not take service fields.')
    if spark not in ('spark2', 'spark3', 'spark4'):
        raise ValueError('Fleet power and workload controls cannot target Spark 1.')
    if action not in ('wake', 'sleep', 'stop_workload'):
        raise ValueError('Unsupported fleet operation.')
    value = {'action': action, 'spark': spark}
    if action == 'stop_workload':
        if not isinstance(container, str) or not re.fullmatch('[a-f0-9]{64}', container):
            raise ValueError('Select the exact observed workload identity.')
        value['container'] = container
    elif container is not None:
        raise ValueError('Power operations do not take a workload.')
    return value


class OperationStore:
    def __init__(self, path, *, clock=time.time):
        self.path, self.clock = Path(path), clock
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd = os.open(self.path, os.O_CREAT | os.O_RDWR, 0o600)
        os.close(fd)
        os.chmod(self.path, 0o600)
        with self._db() as db:
            version = db.execute('PRAGMA user_version').fetchone()[0]
            if version == 0:
                for statement in SCHEMA.split(';'):
                    if statement.strip():
                        db.execute(statement)
            elif version == 1:
                db.execute('CREATE TABLE telegram_cards (operation TEXT NOT NULL, chat INTEGER NOT NULL, '
                           'message INTEGER NOT NULL, PRIMARY KEY (operation, chat, message))')
                db.execute('PRAGMA user_version=2')
            elif version != 2:
                raise ValueError('Unsupported operation database. Preserve it for recovery.')

    @contextmanager
    def _db(self):
        db = sqlite3.connect(self.path, timeout=5)
        db.row_factory = sqlite3.Row
        try:
            with db:
                db.execute('BEGIN IMMEDIATE')
                yield db
        finally:
            db.close()

    @contextmanager
    def _lock(self, operation):
        # Survives multiple workers; a process crash releases the OS lock while
        # the dispatch record and Spark claim remain for reconciliation.
        if not isinstance(operation, str) or not re.fullmatch('[a-f0-9]{32}', operation):
            raise ValueError('Invalid operation identity.')
        folder = self.path.with_suffix('.locks')
        folder.mkdir(mode=0o700, exist_ok=True)
        fd = os.open(folder / operation, os.O_CREAT | os.O_RDWR, 0o600)
        try:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                yield False
            else:
                yield True
        finally:
            os.close(fd)

    def _row(self, db, operation):
        row = db.execute('SELECT * FROM operations WHERE id=?', (operation,)).fetchone()
        if row is None:
            raise ValueError('That operation does not exist.')
        return dict(row)

    def get(self, operation):
        with self._db() as db:
            row = self._row(db, operation)
        return self._view(row)

    def for_request(self, owner, request_key):
        self._owner(owner)
        _text(request_key)
        with self._db() as db:
            found = db.execute('SELECT * FROM operations WHERE request_key=?', (request_key,)).fetchone()
        if found is not None:
            self._owner(owner, found)
            return self._view(dict(found))

    def recent(self, owner):
        self._owner(owner)
        with self._db() as db:
            rows = db.execute('SELECT * FROM operations WHERE generation=? ORDER BY created DESC, id DESC LIMIT 30',
                              (owner.generation,)).fetchall()
        return [self._view(dict(row)) for row in rows]

    def bind_telegram_card(self, owner, operation, *, chat, message):
        """Record only the message returned by the native bot send, never a model argument."""
        if type(chat) is not int or chat <= 0 or type(message) is not int or message <= 0:
            raise ValueError('Invalid confirmation message.')
        with self._db() as db:
            self._owner(owner, self._row(db, operation))
            db.execute('INSERT OR IGNORE INTO telegram_cards VALUES (?,?,?)', (operation, chat, message))

    def require_telegram_card(self, owner, operation, *, chat, message):
        with self._db() as db:
            self._owner(owner, self._row(db, operation))
            if not db.execute('SELECT 1 FROM telegram_cards WHERE operation=? AND chat=? AND message=?',
                              (operation, chat, message)).fetchone():
                raise PermissionError('Use the confirmation button sent for this request.')

    @staticmethod
    def _view(row):
        row['intent'] = json.loads(row['intent'])
        row['cancel_requested'] = bool(row['cancel_requested'])
        return row

    @staticmethod
    def _owner(owner, row=None):
        if not isinstance(owner, Owner) or owner.channel not in ('web', 'telegram') or not owner.generation:
            raise PermissionError('A verified owner request is required.')
        if row is not None and row['generation'] != owner.generation:
            raise PermissionError('Owner access changed. Start a new request.')

    def prepare(self, owner, *, request_key, request_ref, action, spark, container=None, ttl=300, recipe=None, revision=None, instance=None):
        return self._prepare(owner, request_key=request_key, request_ref=request_ref,
                             target=intent(action, spark, container=container, recipe=recipe, revision=revision, instance=instance), ttl=ttl)

    def prepare_proposal(self, owner, *, request_key, request_ref, action, spark, container=None, recipe=None, revision=None, instance=None):
        return self._prepare(owner, request_key=request_key, request_ref=request_ref,
                             target=intent(action, spark, container=container, recipe=recipe, revision=revision, instance=instance), ttl=300,
                             reuse_claim=True)

    def prepare_memory(self, owner, *, request_key, request_ref, plan):
        return self._prepare(owner, request_key=request_key, request_ref=request_ref,
                             target={'action': ERASE_ACTION, 'plan': plan}, ttl=300)

    def prepare_update(self, owner, *, request_key, request_ref, proposal, review):
        from .application_updates import update_intent
        return self._prepare(owner, request_key=request_key, request_ref=request_ref,
                             target=update_intent(proposal, review), ttl=300, reuse_claim=True)

    def _prepare(self, owner, *, request_key, request_ref, target, ttl, reuse_claim=False):
        self._owner(owner)
        _text(request_key); _text(request_ref, 300)
        if type(ttl) is not int or not 1 <= ttl <= 600:
            raise ValueError('The confirmation lifetime must be at most ten minutes.')
        payload = json.dumps(target, sort_keys=True, separators=(',', ':'))
        digest = hashlib.sha256(payload.encode()).hexdigest()
        now, operation = self.clock(), uuid.uuid4().hex
        with self._db() as db:
            old = db.execute('SELECT * FROM operations WHERE request_key=?', (request_key,)).fetchone()
            if old:
                self._owner(owner, old)
                if old['intent'] != payload or old['request_ref'] != request_ref:
                    raise ValueError('That request identity already names a different operation.')
                operation = old['id']
            # A model cannot turn an unresolved change into another confirmation
            # card. Inspect the durable claim in the same transaction as drafting.
            # Do not reveal another owner's operation after enrollment changes.
            if reuse_claim and (old is None or old['state'] == 'pending'):
                blocking = db.execute('SELECT operations.* FROM claims JOIN operations '
                                      'ON operations.id=claims.operation WHERE claims.spark=?',
                                      (target['spark'],)).fetchone()
                if blocking is not None and not _stops_uncertain_start(db, owner, target):
                    self._owner(owner, blocking)
                    return self._view(dict(blocking))
            if old is None:
                db.execute('INSERT INTO operations VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,0)',
                           (operation, request_key, payload, digest, request_ref, owner.generation,
                            owner.channel, 'pending', now + ttl, now, now, None))
        return self.get(operation)

    def confirm(self, owner, operation, digest):
        """Trusted owner button/command only; never register this as an LLM tool."""
        now = self.clock()
        with self._db() as db:
            row = self._row(db, operation)
            self._owner(owner, row)
            if row['digest'] != digest or row['expires'] <= now or row['state'] != 'pending':
                raise PermissionError('That confirmation changed, expired or was already used.')
            db.execute('UPDATE operations SET state=?,updated=?,approved_at=?,approved_channel=? WHERE id=?',
                       ('approved', now, now, owner.channel, operation))
        return self.get(operation)

    def cancel(self, owner, operation):
        with self._db() as db:
            row = self._row(db, operation)
            self._owner(owner, row)
            state = 'cancelled' if row['state'] in ('pending', 'approved') else row['state']
            # A request cannot turn an in-flight effect into a claimed success or stop.
            db.execute('UPDATE operations SET state=?,cancel_requested=1,updated=? WHERE id=?',
                       (state, self.clock(), operation))
        return self.get(operation)

    def run(self, owner, operation, *, dispatch, observe, approval_digest=_NO_APPROVAL):
        """Send once; an owner confirmation claims and records dispatch atomically.

        Native owner controls pass approval_digest so a busy Spark cannot consume
        a confirmation without sending. The separate confirm/run entry points
        remain for trusted callers that already hold an approved receipt.
        """
        self._owner(owner, self.get(operation))
        with self._lock(operation) as acquired:
            if not acquired:
                if approval_digest is not _NO_APPROVAL:
                    raise PermissionError('That confirmation is already being used.')
                return self.get(operation)
            with self._db() as db:
                row = self._row(db, operation)
                self._owner(owner, row)
                if approval_digest is not _NO_APPROVAL:
                    if row['digest'] != approval_digest or row['expires'] <= self.clock() or row['state'] != 'pending':
                        raise PermissionError('That confirmation changed, expired or was already used.')
                elif row['state'] != 'approved':
                    return self._view(row)
                if row['expires'] <= self.clock():
                    raise PermissionError('The confirmation expired before execution.')
                target = json.loads(row['intent'])
                resource = 'memory' if target['action'] == ERASE_ACTION else target['spark']
                if _stops_uncertain_start(db, owner, target):
                    db.execute('DELETE FROM claims WHERE spark=? AND operation=?', (resource, target['instance']))
                try:
                    db.execute('INSERT INTO claims VALUES (?,?)', (resource, operation))
                except sqlite3.IntegrityError:
                    message = ('A memory erase must finish or be checked first.' if resource == 'memory'
                               else 'This Spark has an operation that must finish or be checked first.')
                    raise RuntimeError(message) from None
                if approval_digest is not _NO_APPROVAL:
                    db.execute('UPDATE operations SET approved_at=?,approved_channel=? WHERE id=?',
                               (self.clock(), owner.channel, operation))
                db.execute('UPDATE operations SET state=?,updated=? WHERE id=?', ('dispatching', self.clock(), operation))
            verified = None
            try:
                verified = dispatch(operation, target)
            except NotDispatched:
                return self._finish(operation, 'failed')
            except Exception:
                # No raw exception text: command output may include secrets. The observed
                # remote result, not an exception message, establishes what happened.
                pass
            if target['action'] == ERASE_ACTION and verified is True:
                # The native adapter checked both stores. Until this durable
                # receipt commits a lost result is unknown and cannot resend.
                return self._finish(operation, 'succeeded')
            return self._observe(operation, target, observe)

    def reconcile(self, operation, *, observe):
        """Read after restart/timeout. Never dispatch another change from this path."""
        with self._lock(operation) as acquired:
            if not acquired:
                return self.get(operation)
            row = self.get(operation)
            if row['state'] not in ('dispatching', 'uncertain'):
                return row
            return self._observe(operation, row['intent'], observe)

    def _observe(self, operation, target, observe):
        try:
            # Only the trusted adapter may supply this classification. It must inspect
            # the exact remote operation/effect; SSH failure is never a successful stop.
            outcome = observe(operation, target)
        except Exception:
            outcome = 'unknown'
        if outcome not in ('succeeded', 'failed', 'unknown'):
            outcome = 'unknown'
        return self._finish(operation, outcome)

    def _finish(self, operation, outcome):
        state = 'uncertain' if outcome == 'unknown' else outcome
        with self._db() as db:
            db.execute('UPDATE operations SET state=?,outcome=?,updated=? WHERE id=?',
                       (state, outcome, self.clock(), operation))
            if state in TERMINAL:
                db.execute('DELETE FROM claims WHERE operation=?', (operation,))
        return self.get(operation)
