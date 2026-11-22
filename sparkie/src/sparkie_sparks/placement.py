"""Prefer already awake compute Sparks using the existing collector snapshot.

This only orders candidates. The lease budget, verified physical identity and
worker's fresh capacity checks remain authoritative before execution.
"""
from .fleet import read_status


class AwakeFirst:
    def __init__(self, sparks, *, snapshot, reader=read_status):
        self.sparks = tuple(sparks)
        if (not self.sparks or len(set(self.sparks)) != len(self.sparks)
                or any(spark not in ('spark2', 'spark3', 'spark4') for spark in self.sparks)):
            raise ValueError('Choose distinct configured compute Sparks.')
        self.snapshot, self.reader = snapshot, reader

    def __call__(self, scope, request):
        result = self.reader(path=self.snapshot)
        rows = {row['id']: row for row in result.get('sparks', [])} if result.get('available') else {}
        def rank(spark):
            row = rows.get(spark, {})
            if row.get('stale') is not False or row.get('issue'):
                return 2
            return 0 if row.get('observed_state') == 'online' else 1 if row.get('observed_state') == 'off' else 2
        return tuple(sorted(self.sparks, key=rank))
