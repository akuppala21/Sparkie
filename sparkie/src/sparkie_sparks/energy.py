"""Persistent meter history with costs calculated at the requested rate.

Missing intervals are excluded, never filled with zero. Reads do not create or
migrate storage. Rates and calculated costs are not stored.
"""
from datetime import datetime, timedelta, timezone
import math
import os
from pathlib import Path
import re
import sqlite3
from zoneinfo import ZoneInfo

ZONE = ZoneInfo('America/Los_Angeles')
SPARKS = ('spark1', 'spark2', 'spark3', 'spark4')
MAX_INTERVAL_SECONDS = 900
RATE_PRESETS = [0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.60]
SCHEMA = '''CREATE TABLE IF NOT EXISTS readings (
 spark TEXT NOT NULL, at REAL NOT NULL, meter TEXT NOT NULL, value REAL NOT NULL, month TEXT NOT NULL, kind TEXT NOT NULL,
 PRIMARY KEY(spark, at)
); CREATE INDEX IF NOT EXISTS readings_at ON readings(at);
CREATE INDEX IF NOT EXISTS readings_month ON readings(month);
PRAGMA user_version=2;'''


def _time(value):
    when = datetime.fromisoformat(value.replace('Z', '+00:00')) if isinstance(value, str) else value
    if not isinstance(when, datetime) or when.tzinfo is None:
        raise ValueError('A reading needs a time with its timezone.')
    return when


def _initialize(db):
    if db.execute('PRAGMA user_version').fetchone()[0] not in (0, 2):
        raise ValueError('Unsupported meter database.')
    db.executescript(SCHEMA)


def record(path, *, spark, at, meter, kwh):
    return _record(path, spark=spark, at=at, meter=meter, value=kwh, kind='counter')


def record_power(path, *, spark, at, meter, watts):
    return _record(path, spark=spark, at=at, meter=meter, value=watts, kind='power')


def _record(path, *, spark, at, meter, value, kind):
    if spark not in SPARKS or not isinstance(meter, str) or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,128}', meter):
        raise ValueError('A reading needs a known Spark and meter identity.')
    if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= (3000 if kind == 'power' else 1e12):
        raise ValueError('A reading needs a finite, nonnegative measurement within the meter range.')
    when = _time(at)
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o750)
    with sqlite3.connect(target) as db:
        _initialize(db)
        db.execute('BEGIN IMMEDIATE')
        old = db.execute('SELECT meter,value,kind FROM readings WHERE spark=? AND at=?', (spark, when.timestamp())).fetchone()
        if old and old != (meter, value, kind):
            raise ValueError('A different reading already exists at this time.')
        db.execute('INSERT OR IGNORE INTO readings VALUES (?,?,?,?,?,?)',
                   (spark, when.timestamp(), meter, value, when.astimezone(ZONE).strftime('%Y-%m'), kind))


def _rate(value):
    if value is not None and (type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 10):
        raise ValueError('Choose a rate from $0 to $10 per kWh.')
    return value


def _key(period, when):
    local = when.astimezone(ZONE)
    if period == 'week':
        year, week, _ = local.isocalendar()
        return f'{year:04}-W{week:02}'
    return local.strftime({'day': '%Y-%m-%d', 'month': '%Y-%m', 'year': '%Y'}[period])


def _period(selected, now, period='month'):
    patterns = {'day': r'\d{4}-\d{2}-\d{2}', 'week': r'\d{4}-W\d{2}', 'month': r'\d{4}-\d{2}', 'year': r'\d{4}'}
    if period not in patterns or not isinstance(selected, str) or not re.fullmatch(patterns[period], selected):
        raise ValueError('Choose a valid day, week, month or year.')
    if period == 'week':
        year, week = selected.split('-W')
        start = datetime.fromisocalendar(int(year), int(week), 1).replace(tzinfo=ZONE)
        finish = start + timedelta(days=7)
    elif period == 'day':
        start = datetime.fromisoformat(selected).replace(tzinfo=ZONE)
        finish = start + timedelta(days=1)
    elif period == 'year':
        start, finish = datetime(int(selected), 1, 1, tzinfo=ZONE), datetime(int(selected) + 1, 1, 1, tzinfo=ZONE)
    else:
        year, number = map(int, selected.split('-'))
        start = datetime(year, number, 1, tzinfo=ZONE)
        finish = datetime(year + 1, 1, 1, tzinfo=ZONE) if number == 12 else datetime(year, number + 1, 1, tzinfo=ZONE)
    if start.timestamp() > now.timestamp():
        raise ValueError('That period has not started.')
    return start.timestamp(), min(finish.timestamp(), now.timestamp())


def _usage(kind, a, b, value_a, value_b, left, right):
    if kind == 'counter':
        return (value_b - value_a) * (right - left) / (b - a)
    watts_left = value_a + (value_b - value_a) * (left - a) / (b - a)
    watts_right = value_a + (value_b - value_a) * (right - a) / (b - a)
    return (watts_left + watts_right) / 2 * (right - left) / 3600000


def read_energy(*, path=None, month=None, period='month', selected=None, rate=None, now=None):
    rate = _rate(rate)
    now = _time(now or datetime.now(timezone.utc))
    if period not in ('day', 'week', 'month', 'year') or month is not None and (period != 'month' or selected is not None and selected != month):
        raise ValueError('Choose one electricity period.')
    current = _key(period, now)
    if selected is None:
        selected = month if month is not None else current
    start, end = _period(selected, now, period)
    current_month = _key('month', now)
    unavailable = {'available': False, 'month': selected if period == 'month' else current_month, 'months': [current_month],
                   'period': period, 'selected': selected, 'periods': [current], 'timezone': str(ZONE),
                   'recorded_kwh': None, 'sparks': [], 'cost_usd': None,
                   'rate_usd_per_kwh': rate, 'rate_presets': RATE_PRESETS,
                   'cost_message': 'Choose a rate to calculate the cost of recorded usage.',
                   'message': 'Electricity readings are not connected yet.'}
    path = path or os.environ.get('SPARKIE_ENERGY_DATABASE')
    if not path:
        return unavailable
    try:
        with sqlite3.connect(Path(path).resolve().as_uri() + '?mode=ro', uri=True) as db:
            version = db.execute('PRAGMA user_version').fetchone()[0]
            if version != 2:
                return unavailable
            dates = db.execute('SELECT DISTINCT month FROM readings WHERE at<=?', (now.timestamp(),)).fetchall()
            imported = (db.execute('SELECT spark,month,kwh,covered_seconds,since,until FROM monthly_history WHERE until<=?',
                                   (now.timestamp(),)).fetchall()
                        if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='monthly_history'").fetchone() else [])
            months = sorted({current_month, *(row[0] for row in dates), *(row[1] for row in imported)}, reverse=True)
            if period == 'month':
                history = months
            elif period == 'year':
                history = [value[:4] for value in months]
            else:
                # A UTC day spans at most two Pacific calendar dates. Its first
                # and last observed samples identify both without converting
                # every retained minute in Python on each dashboard read.
                edges = db.execute('SELECT MIN(at),MAX(at) FROM readings WHERE at<=? GROUP BY CAST(at/86400 AS INTEGER)',
                                   (now.timestamp(),)).fetchall()
                history = [_key(period, datetime.fromtimestamp(stamp, timezone.utc)) for pair in edges for stamp in pair]
            periods = sorted({current, selected, *history}, reverse=True)
            rows = db.execute('SELECT spark,at,meter,value,kind FROM readings WHERE at>=? AND at<=? ORDER BY spark,at',
                              (start - MAX_INTERVAL_SECONDS, min(end + MAX_INTERVAL_SECONDS, now.timestamp()))).fetchall()
    except (OSError, sqlite3.Error, ValueError, OverflowError):
        return {**unavailable, 'message': 'Electricity readings could not be read. Try again after the next update.'}
    summary = []
    included = [row for row in imported if period in ('month', 'year') and start <= row[4] and row[5] <= end]
    for spark in SPARKS:
        samples = [row for row in rows if row[0] == spark]
        history = [row for row in included if row[0] == spark]
        energy, coverage, intervals = sum(row[2] for row in history), sum(row[3] for row in history), len(history)
        resets = changes = 0
        estimated, estimated_power = False, bool(history)
        cutoff = max((row[5] for row in imported if row[0] == spark), default=float('-inf'))
        for before, after in zip(samples, samples[1:]):
            _, a, meter_a, value_a, kind_a = before
            _, b, meter_b, value_b, kind_b = after
            left, right = max(start, a, cutoff), min(end, b)
            if right <= left:
                continue
            if meter_a != meter_b or kind_a != kind_b:
                changes += 1
                continue
            if kind_a == 'counter' and value_b < value_a:
                resets += 1
                continue
            if b - a > MAX_INTERVAL_SECONDS or kind_a not in ('counter', 'power'):
                continue
            energy += _usage(kind_a, a, b, value_a, value_b, left, right)
            coverage += right - left
            intervals += 1
            estimated |= left != a or right != b
            estimated_power |= kind_a == 'power'
        summary.append({'id': spark, 'name': 'Spark ' + spark[-1],
                        'recorded_kwh': round(energy, 6) if intervals else None,
                        'cost_usd': round(energy * rate, 6) if intervals and rate is not None else None,
                        'covered_seconds': round(coverage), 'missing_seconds': round(max(0, end - start - coverage)),
                        'estimated_boundary': estimated, 'estimated_from_power': estimated_power,
                        'counter_resets': resets, 'meter_changes': changes})
    known = [row['recorded_kwh'] for row in summary if row['recorded_kwh'] is not None]
    costs = [row['cost_usd'] for row in summary if row['cost_usd'] is not None]
    partial = any(row['missing_seconds'] > 0 or row['recorded_kwh'] is None for row in summary)
    estimated = any(row['estimated_boundary'] for row in summary)
    estimated_power = any(row['estimated_from_power'] for row in summary)
    message = 'Recorded wall-meter electricity. Missing intervals are excluded.' if partial else 'Wall-meter electricity for this ' + period + '.'
    if estimated:
        message += ' Usage across a period boundary is divided by elapsed time and is an estimate.'
    if estimated_power:
        message += ' Energy calculated from power samples is an estimate.'
    if imported:
        message += (' Earlier monthly totals are included; their daily and weekly detail was not recorded.'
                    if included else ' Earlier usage is kept in monthly and yearly views. Its daily and weekly detail was not recorded.')
    return {**unavailable, 'available': bool(dates or imported), 'months': months, 'periods': periods,
            'recorded_kwh': round(sum(known), 6) if known else None, 'partial': partial,
            'cost_usd': round(sum(costs), 6) if costs else None,
            'cost_message': ('Choose a rate to calculate the cost of recorded usage.' if rate is None else
                             'Recorded usage multiplied by the selected rate. Missing usage, fixed charges and taxes are excluded. This is an estimate, not an electricity bill.'),
            'estimated_boundary': estimated, 'estimated_from_power': estimated_power,
            'sparks': summary, 'message': message}
