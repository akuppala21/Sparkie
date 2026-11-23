"""Read bounded, timestamped observations without waking a Spark.

The collector/executor is separate from the model process. Only explicitly selected
display fields leave this module; a snapshot is evidence of an observation, not
proof that a machine is still in the same state.
"""

from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import re

MAX_SNAPSHOT_BYTES = 65536
MAX_AGE_SECONDS = 300
STATES = frozenset({"online", "off", "starting", "stopping", "unreachable", "unknown"})
METRICS = {
    "memory_total_bytes": 2**60, "memory_available_bytes": 2**60,
    "disk_total_bytes": 2**60, "disk_free_bytes": 2**60,
    "uptime_seconds": 2**40, "gpu_utilization_percent": 100,
    "gpu_temperature_c": 150, "gpu_power_watts": 10000,
}


def _details(row):
    """Select display fields; unrelated probe output never reaches the model or page."""
    metrics = row.get('metrics')
    selected = {}
    if isinstance(metrics, dict):
        for key, limit in METRICS.items():
            value = metrics.get(key)
            if type(value) in (int, float) and math.isfinite(value) and 0 <= value <= limit:
                selected[key] = value
    workloads = row.get('workloads')
    clean = None
    if isinstance(workloads, list) and len(workloads) <= 100:
        clean = []
        for item in workloads:
            if not isinstance(item, dict):
                clean = None
                break
            identifier, name, image = (item.get(k) for k in ('id', 'name', 'image'))
            if not (isinstance(identifier, str) and re.fullmatch(r'[a-f0-9]{12,64}', identifier)
                    and isinstance(name, str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,127}', name)
                    and isinstance(image, str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_./:@-]{0,255}', image)):
                clean = None
                break
            clean.append({'id': identifier, 'name': name, 'image': image,
                          'kind': 'infrastructure' if item.get('kind') == 'infrastructure' else 'workload'})
    links = row.get('network_links')
    network = None
    if isinstance(links, list) and len(links) <= 16:
        network = []
        for link in links:
            if (not isinstance(link, dict) or not isinstance(link.get('name'), str)
                    or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}', link['name'])
                    or link.get('kind') not in ('ethernet', 'wifi')
                    or link.get('state') not in ('up', 'down', 'unknown')):
                network = None
                break
            speed = link.get('speed_mbps')
            network.append({'name': link['name'], 'kind': link['kind'], 'state': link['state'],
                            'speed_mbps': speed if type(speed) is int and 0 < speed <= 1600000
                            and link['state'] == 'up' else None})
    result = {'metrics': selected, 'workloads': clean, 'network_links': network}
    wall = row.get('wall')
    if isinstance(wall, dict):
        result['wall'] = {'on': wall.get('on') if type(wall.get('on')) is bool else None,
                          'source': 'Matter device read' if wall.get('source') == 'Matter device read' else 'Matter controller report'}
        for key, limit in (('watts', 3000), ('cumulative_kwh', 1e12)):
            value = wall.get(key)
            result['wall'][key] = value if type(value) in (int, float) and math.isfinite(value) and 0 <= value <= limit else None
        result['wall']['observed_at'] = _timestamp(wall.get('observed_at')).astimezone(timezone.utc).isoformat()
    if row.get('issue') == 'identity_mismatch':
        result['issue'] = 'The responding machine did not match this Spark. Check its saved address.'
    elif (row.get('state') == 'unreachable' and isinstance(wall, dict)
          and wall.get('on') is True and wall.get('source') == 'Matter device read'):
        result['issue'] = ('The plug reported power on. The management check could not verify '
                           'the Spark or its workloads.')
    return result


def _timestamp(value):
    if not isinstance(value, str):
        raise ValueError("Missing observation time")
    when = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if when.tzinfo is None:
        raise ValueError("Observation time needs a timezone")
    return when


def read_status(*, path=None, now=None):
    """Return a display-safe observation, or an explicit unavailable result."""
    path = path or os.environ.get("SPARKIE_FLEET_SNAPSHOT")
    if not path:
        return {"available": False, "sparks": [], "message": "Fleet observations are not connected yet."}
    now = now or datetime.now(timezone.utc)
    try:
        with Path(path).open("rb") as stream:
            raw = stream.read(MAX_SNAPSHOT_BYTES + 1)
        if len(raw) > MAX_SNAPSHOT_BYTES:
            raise ValueError("Snapshot too large")
        data = json.loads(raw)
        if not isinstance(data, dict) or data.get("schema") != 1:
            raise ValueError("Unsupported snapshot")
        rows = data.get("sparks")
        if not isinstance(rows, list) or len(rows) > 4:
            raise ValueError("Invalid fleet")
        result, seen = [], set()
        for row in rows:
            if not isinstance(row, dict):
                raise ValueError("Invalid observation")
            spark = row.get("id")
            if spark not in {"spark1", "spark2", "spark3", "spark4"} or spark in seen:
                raise ValueError("Invalid or duplicate Spark")
            seen.add(spark)
            state = row.get("state")
            if not isinstance(state, str) or state not in STATES:
                raise ValueError("Invalid state")
            observed = _timestamp(row.get("observed_at"))
            age = (now - observed).total_seconds()
            if age < -30:
                raise ValueError("Observation is in the future")
            result.append({
                "id": spark,
                "name": "Spark " + spark[-1],
                "host": spark == "spark1",
                "observed_state": state,
                "observed_at": observed.astimezone(timezone.utc).isoformat(),
                "stale": age > MAX_AGE_SECONDS,
                **_details(row),
            })
        return {"available": True, "sparks": sorted(result, key=lambda r: r["id"]),
                "message": "Recorded observations; this lookup does not wake machines."}
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError, TypeError, OverflowError):
        return {"available": False, "sparks": [], "message": "Fleet observations could not be read. Try again after the next update."}
