"""Import retained monthly totals once, without inventing individual readings."""
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import sqlite3

from .energy import SPARKS, ZONE, _initialize

TABLE = '''CREATE TABLE IF NOT EXISTS monthly_history (
 spark TEXT NOT NULL, month TEXT NOT NULL, kwh REAL NOT NULL,
 covered_seconds REAL NOT NULL, since REAL NOT NULL, until REAL NOT NULL,
 source_sha256 TEXT NOT NULL, PRIMARY KEY(spark,month)
)'''


def import_monthly(source, destination, *, now=None):
    """Run after the old writer stops and before the new collector starts.

    Repeating identical totals is safe. Conflicting imports or overlapping
    detailed readings are refused. The original file is never changed.
    """
    raw = Path(source).read_bytes()
    if len(raw) > 8 * 1024 * 1024:
        raise ValueError('The retained electricity file exceeds its import limit.')
    digest = hashlib.sha256(raw).hexdigest()
    document = json.loads(raw)
    saved = document.get('wallMonthly') if isinstance(document, dict) else None
    if (not isinstance(saved, dict) or saved.get('version') != 1
            or saved.get('timeZone') != str(ZONE) or not isinstance(saved.get('months'), dict)):
        raise ValueError('The retained monthly electricity format is unsupported; keep the source file.')
    now = (now or datetime.now(timezone.utc)).timestamp()
    rows = []
    for month, bucket in saved['months'].items():
        if not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])', month) or not isinstance(bucket, dict) or not isinstance(bucket.get('nodes'), dict):
            raise ValueError('A retained electricity month is invalid.')
        year, number = map(int, month.split('-'))
        start = datetime(year, number, 1, tzinfo=ZONE).timestamp()
        end = datetime(year + (number == 12), 1 if number == 12 else number + 1, 1, tzinfo=ZONE).timestamp()
        for spark, row in bucket['nodes'].items():
            if spark not in SPARKS or not isinstance(row, dict):
                raise ValueError('A retained electricity Spark is invalid.')
            values = [row.get(key) for key in ('kWh', 'coverageSeconds', 'since', 'until')]
            if any(type(value) not in (int, float) or not math.isfinite(value) or value < 0 for value in values):
                raise ValueError('A retained electricity total is invalid.')
            kwh, coverage, since_ms, until_ms = values
            since, until = since_ms / 1000, until_ms / 1000
            if (not start <= since <= until <= min(end, now) or coverage > until - since + 0.001
                    or coverage == 0 and kwh != 0 or kwh > coverage * 3000 / 3600000 + 0.000001):
                raise ValueError('A retained electricity interval is invalid.')
            if coverage:
                rows.append((spark, month, kwh, coverage, since, until, digest))
    target = Path(destination)
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o750)
    with sqlite3.connect(target) as db:
        _initialize(db)
        db.execute('BEGIN IMMEDIATE')
        db.execute(TABLE)
        for row in rows:
            # No interpolation of the old monthly total is possible. Reject
            # any earlier new sample, including a boundary-spanning interval.
            if db.execute('SELECT 1 FROM readings WHERE spark=? AND at<? LIMIT 1', (row[0], row[5])).fetchone():
                raise ValueError('Detailed readings overlap retained monthly history; no totals were imported.')
            old = db.execute('SELECT spark,month,kwh,covered_seconds,since,until FROM monthly_history WHERE spark=? AND month=?', row[:2]).fetchone()
            if old and old != row[:6]:
                raise ValueError('A different monthly history is already stored; no totals were replaced.')
            db.execute('INSERT OR IGNORE INTO monthly_history VALUES (?,?,?,?,?,?,?)', row)
    return {'source_sha256': digest, 'monthly_totals': len(rows),
            'message': 'Monthly usage preserved. No daily or weekly readings were invented.'}
