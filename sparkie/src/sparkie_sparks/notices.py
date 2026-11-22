"""One completion disposition on an existing fleet receipt, using native Hermes send.

The collector already advances long operations. Its maintenance pass also sends
their final Telegram result. There is no new queue, timer, bot poller or AI call.
An uncertain send is never replayed. Native web transcript notes are not supplied
by this adapter; the existing authenticated operation view remains authoritative.
"""
import hashlib
import io
import json
import os
from pathlib import Path
import stat
import subprocess

from .operations import TERMINAL, NotDispatched
from .io_budget import remaining_io


class CompletionNotices:
    def __init__(self, store, *, binding):
        self.store, self.binding = store, binding
        with store._db() as db:
            db.execute('CREATE TABLE IF NOT EXISTS operation_notices ('
                       'operation TEXT PRIMARY KEY, generation TEXT NOT NULL, '
                       'chat INTEGER NOT NULL, state TEXT NOT NULL)')

    def bind(self, owner, operation):
        """Trusted initial Telegram context only; a later view cannot change origin."""
        binding = self.binding()
        if owner.channel != 'telegram' or owner.generation != binding.generation:
            raise PermissionError('Use the current paired Telegram owner.')
        with self.store._db() as db:
            row = self.store._row(db, operation)
            self.store._owner(owner, row)
            existing = db.execute('SELECT generation,chat FROM operation_notices WHERE operation=?',
                                  (operation,)).fetchone()
            if existing:
                if tuple(existing) != (binding.generation, binding.telegram_chat):
                    raise PermissionError('The original conversation cannot change.')
                return
            if row['state'] != 'pending':
                raise PermissionError('Only a new request can bind its original conversation.')
            db.execute('INSERT INTO operation_notices VALUES (?,?,?,?)',
                       (operation, binding.generation, binding.telegram_chat, 'waiting'))

    def arm(self, operation=None):
        """Only an observed in-flight operation needs a later completion notice."""
        with self.store._db() as db:
            db.execute("UPDATE operation_notices SET state='pending' WHERE state='waiting' "
                       "AND operation IN (SELECT id FROM operations WHERE state IN ('dispatching','uncertain')) "
                       'AND (? IS NULL OR operation=?)', (operation, operation))

    def status(self, operation):
        with self.store._db() as db:
            row = db.execute('SELECT state FROM operation_notices WHERE operation=?', (operation,)).fetchone()
        return row[0] if row else None

    def _state(self, operation, state):
        with self.store._db() as db:
            db.execute('UPDATE operation_notices SET state=? WHERE operation=?', (state, operation))

    def deliver(self, sender, *, view, limit=4):
        """Called by existing maintenance. Hold a per-notice OS lock across dispatch."""
        from .controls import result_text
        self.arm()
        with self.store._db() as db:
            pending = db.execute("SELECT n.* FROM operation_notices n JOIN operations o ON o.id=n.operation "
                "WHERE n.state IN ('pending','unavailable','dispatching') AND o.state IN ('succeeded','failed','cancelled') "
                'ORDER BY o.updated,o.id LIMIT ?', (limit,)).fetchall()
        result = []
        for saved in pending:
            operation = saved['operation']
            lock = hashlib.sha256(('completion-notice:' + operation).encode()).hexdigest()[:32]
            with self.store._lock(lock) as acquired:
                if not acquired:
                    continue
                state = self.status(operation)
                if state == 'dispatching':
                    # The previous process may have sent before losing its ack.
                    self._state(operation, 'unknown')
                elif state in ('pending', 'unavailable'):
                    row = self.store.get(operation)
                    def authorized():
                        current = self.binding()
                        return (current.generation == saved['generation'] == row['generation']
                                and current.telegram_chat == saved['chat'])
                    if row['state'] not in TERMINAL:
                        continue
                    if not authorized():
                        self._state(operation, 'suppressed')
                    else:
                        # A proven preflight refusal is being retried. Its old
                        # delivery warning is not part of the hardware result.
                        if state == 'unavailable':
                            self._state(operation, 'pending')
                        shown = view(row)
                        text = result_text(shown)
                        self._state(operation, 'dispatching')  # Before any transport call.
                        try:
                            sent = sender(chat=saved['chat'], text=text, authorized=authorized)
                        except NotDispatched:
                            self._state(operation, 'suppressed' if not authorized() else 'unavailable')
                        except Exception:
                            self._state(operation, 'unknown')
                        else:
                            self._state(operation, 'sent' if sent is True else 'unknown')
                result.append({'operation': operation, 'notification': self.status(operation)})
        return result


def _private_bytes(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        info = os.fstat(stream.fileno())
        owner_only = info.st_uid in (0, os.geteuid()) and not info.st_mode & 0o077
        root_group = info.st_uid == 0 and info.st_gid == os.getegid() and stat.S_IMODE(info.st_mode) == 0o640
        if not stat.S_ISREG(info.st_mode) or not (owner_only or root_group):
            raise ValueError('The native sender requires protected configuration.')
        data = stream.read(32769)
    if len(data) > 32768:
        raise ValueError('The native sender configuration is too large.')
    return data


class NativeTelegramSender:
    """The documented hermes send CLI; no direct Telegram API or token logs."""
    def __init__(self, config, *, runner=subprocess.run):
        if (not isinstance(config, dict) or set(config) != {'home', 'environment', 'python', 'source'}
                or any(not isinstance(value, str) or not Path(value).is_absolute()
                       or any(c in value for c in '\n\r\x00') for value in config.values())):
            raise ValueError('Configure fixed private native sender paths.')
        source, python = Path(config['source']), Path(config['python'])
        if python != source / '.venv/bin/python':
            raise ValueError('Use the reviewed candidate interpreter beside its Hermes source.')
        self.config, self.runner = dict(config), runner

    def __call__(self, *, chat, text, authorized):
        try:
            from dotenv import dotenv_values
            raw = _private_bytes(self.config['environment']).decode('utf-8')
            values = dotenv_values(stream=io.StringIO(raw), interpolate=False)
            needed = ('TELEGRAM_BOT_TOKEN', 'TELEGRAM_ALLOWED_USERS', 'TELEGRAM_HOME_CHANNEL')
            if (type(chat) is not int or chat <= 0 or not values.get(needed[0])
                    or any(values.get(key) != str(chat) for key in needed[1:])):
                raise ValueError('The current Telegram settings do not match the original conversation.')
            home, source = Path(self.config['home']), Path(self.config['source'])
            # Native CLI loads this file with override=True. An independently
            # writable profile must never replace the protected sender identity.
            if _private_bytes(home / '.env').strip():
                raise ValueError('The prepared native home must retain its empty protected environment.')
            env = {'PATH': '/usr/bin:/bin', 'HERMES_HOME': str(home),
                   'HERMES_MANAGED_DIR': str(home / 'managed'), 'HERMES_CONFIG_BACKEND': 'file',
                   'HERMES_ENABLE_PROJECT_PLUGINS': '0', 'HERMES_DISABLE_LAZY_INSTALLS': '1',
                   'HERMES_BUNDLED_PLUGINS': str(source.parent / 'bundled-plugins'),
                   'PYTHONPATH': str(source) + ':' + str(source.parent / 'extension/src'),
                   'PYTHONDONTWRITEBYTECODE': '1', 'GATEWAY_ALLOW_ALL_USERS': 'false',
                   **{key: values[key] for key in needed}}
            timeout = remaining_io(20)
        except (OSError, UnicodeError, ValueError, ImportError, TimeoutError):
            raise NotDispatched('The protected native notification sender is unavailable.') from None
        # Check after reading credentials/config, immediately before the effect.
        if not authorized():
            raise NotDispatched('Owner access changed before the completion notice.')
        result = self.runner([self.config['python'], '-m', 'hermes_cli.main', 'send', '--to',
                              'telegram:' + str(chat), '--file', '-', '--json'],
                             input=text, capture_output=True, text=True, env=env,
                             cwd=self.config['source'], timeout=timeout, check=False)
        try:
            payload = json.loads(result.stdout) if len(result.stdout) <= 16384 else {}
            return result.returncode == 0 and isinstance(payload, dict) and payload.get('success') is True
        except (ValueError, TypeError):
            return False
