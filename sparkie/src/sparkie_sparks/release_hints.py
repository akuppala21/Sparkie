"""Small durable cleanup hints retried by the existing controller scan.

Only task/workspace/generation IDs are stored. This is not an approval or an
instruction queue: the private controller validates the current generation and
independently checks work before retiring any container.
"""
import json
import os
from pathlib import Path
import re

from .workspace_worker import _private_dir, _read, _write

ID = re.compile(r'[a-f0-9]{32}\Z')


def validate(value):
    if (not isinstance(value, dict) or set(value) != {'task_id', 'workspace_id', 'generation'}
            or not isinstance(value['task_id'], str) or not 0 < len(value['task_id']) <= 512
            or any(ord(c) < 32 for c in value['task_id'])
            or any(not isinstance(value[key], str) or not ID.fullmatch(value[key])
                   for key in ('workspace_id', 'generation'))):
        raise ValueError('Use the exact native workspace cleanup identity.')
    return value


class ReleaseHints:
    def __init__(self, path):
        self.path = Path(path)
        if not self.path.is_absolute():
            raise ValueError('Use the protected absolute cleanup cache path.')
        _private_dir(self.path)

    def _path(self, value):
        validate(value)
        return self.path / (value['workspace_id'] + '-' + value['generation'] + '.json')

    def save(self, value):
        _write(self._path(value), json.dumps(value, sort_keys=True) + '\n')

    def remove(self, value):
        self._path(value).unlink(missing_ok=True)
        directory = os.open(self.path, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)

    def pending(self):
        for path in sorted(self.path.glob('*.json'))[:100]:
            try:
                value = validate(json.loads(_read(path)))
                if path != self._path(value):
                    continue
                yield value
            except (OSError, ValueError, TypeError):
                # Preserve unexpected files for diagnosis; never execute them.
                continue
