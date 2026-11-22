"""Read the maintained Matter controller through its documented JSON/WebSocket API.

Only the private collector uses this module. It exposes no arbitrary device command,
accepts no model-selected URL and does not include a path to switch a plug.
"""

from datetime import datetime, timezone
import hashlib
import json
import math
import re
import time
from urllib.parse import urlparse
import uuid

from .energy import record, record_power
from .io_budget import remaining_io

SPARKS = frozenset({'spark1', 'spark2', 'spark3', 'spark4'})
DEVICE_PATHS = ('0/40/18', '*/6/0', '*/144/8', '*/145/1')


def validate_mapping(mapping):
    if not isinstance(mapping, dict) or not mapping or len(mapping) > 4:
        raise ValueError('The plug mapping needs one to four Sparks.')
    nodes, fingerprints = set(), set()
    for spark, item in mapping.items():
        if spark not in SPARKS or not isinstance(item, dict):
            raise ValueError('Invalid Spark in the plug mapping.')
        node, fingerprint = item.get('node'), item.get('fingerprint')
        if type(node) is not int or not 0 < node < 2**64 or node in nodes:
            raise ValueError('Each Spark needs its own valid controller node.')
        if not isinstance(fingerprint, str) or not re.fullmatch('[a-f0-9]{64}', fingerprint) or fingerprint in fingerprints:
            raise ValueError('Each Spark needs its own verified plug identity.')
        if type(item.get('read_only', False)) is not bool:
            raise ValueError('The read-only flag must be true or false.')
        if spark == 'spark1' and item.get('read_only') is not True:
            raise ValueError('Spark 1 must remain read-only.')
        nodes.add(node)
        fingerprints.add(fingerprint)
    return mapping


def _attribute(attributes, cluster, attribute):
    matches = [value for key, value in attributes.items()
               if isinstance(key, str) and re.fullmatch(r'\d+/' + str(cluster) + '/' + str(attribute), key)]
    return matches[0] if len(matches) == 1 else None


def _scaled(value, scale, maximum):
    if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= maximum * scale:
        return None
    return value / scale


def readings(nodes, mapping, *, now=None):
    """Map controller reports to Sparks only when their stable device identities match."""
    validate_mapping(mapping)
    if not isinstance(nodes, list) or len(nodes) > 100:
        raise ValueError('Invalid controller response.')
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        raise ValueError('An observation needs a timezone.')
    result = []
    for spark, binding in sorted(mapping.items()):
        row = {'id': spark, 'observed_at': now.isoformat(), 'available': False,
               'read_only': spark == 'spark1' or binding.get('read_only', False),
               'source': 'Matter controller report', 'on': None, 'watts': None, 'cumulative_kwh': None}
        matching = [n for n in nodes if isinstance(n, dict) and n.get('node_id') == binding['node']]
        if len(matching) != 1:
            row['issue'] = 'The mapped plug is missing or ambiguous.'
            result.append(row)
            continue
        node = matching[0]
        attrs = node.get('attributes')
        uid = attrs.get('0/40/18') if isinstance(attrs, dict) else None
        if not isinstance(uid, str) or not uid or hashlib.sha256(uid.encode()).hexdigest() != binding['fingerprint']:
            row['issue'] = 'The plug identity changed. Verify its Spark before using it.'
        elif node.get('available') is not True:
            row['issue'] = 'The plug is not answering the controller.'
        else:
            on = _attribute(attrs, 6, 0)
            counter = _attribute(attrs, 145, 1)
            # Matter electrical power is mW; imported cumulative energy is mWh.
            # EnergyMeasurementStruct field 0 is Energy. Never confuse Wh with kWh.
            row.update(available=True, on=on if type(on) is bool else None,
                       watts=_scaled(_attribute(attrs, 144, 8), 1000, 3000),
                       cumulative_kwh=_scaled(counter.get('0') if isinstance(counter, dict) else None, 1000000, 1e12))
        result.append(row)
    return result


class MatterReader:
    def __init__(self, url='ws://127.0.0.1:5580/ws', *, connect=None, clock=None):
        parsed = urlparse(url)
        if parsed.scheme != 'ws' or parsed.hostname not in ('127.0.0.1', '::1', 'localhost') or parsed.username or parsed.password:
            raise ValueError('Use the private local Matter controller.')
        self.url = url
        self.connect = connect
        self.clock = clock or (lambda: datetime.now(timezone.utc))

    def _ask(self, command, args):
        connect = self.connect
        if connect is None:
            from websockets.sync.client import connect
        request_id = uuid.uuid4().hex
        until = time.monotonic() + remaining_io(8)
        with connect(self.url, open_timeout=remaining_io(5), close_timeout=remaining_io(1), max_size=1048576) as ws:
            json.loads(ws.recv(timeout=remaining_io(5)))  # Native server information comes first.
            remaining_io(1)
            ws.send(json.dumps({'message_id': request_id, 'command': command, 'args': args}))
            for _ in range(100):
                remaining = until - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError('The plug controller did not answer.')
                reply = json.loads(ws.recv(timeout=remaining))
                if not isinstance(reply, dict) or reply.get('message_id') != request_id:
                    continue
                if reply.get('error_code') is not None:
                    raise ValueError('The plug controller refused the status read.')
                return reply.get('result')
            raise ValueError('The plug controller did not return the requested status.')

    def nodes(self):
        """Controller inventory for discovery only; its attributes can be cached."""
        nodes = self._ask('get_nodes', {})
        if not isinstance(nodes, list):
            raise ValueError('The plug controller returned an invalid node list.')
        return nodes

    def measurements(self, mapping):
        """Read the mapped physical devices; never renew cached measurements.

        v1.5.5 read_attribute performs a native Matter read and returns only the
        attributes in that reply. Wildcard endpoints avoid assuming endpoint 1;
        ambiguous multi-outlet replies are refused. Unsupported meter attributes
        stay missing, and a failed device cannot supply a new energy sample.
        """
        validate_mapping(mapping)
        result = []
        for spark, binding in sorted(mapping.items()):
            one = {spark: binding}
            try:
                attributes = self._ask('read_attribute', {
                    'node_id': binding['node'], 'attribute_path': list(DEVICE_PATHS),
                })
                measured_at = self.clock()  # Completed device read, not a cache lookup.
                if not isinstance(attributes, dict) or len(attributes) > 128:
                    raise ValueError('Invalid device attributes.')
                # The physical identity, switch and meter may live on different
                # endpoints, but no attribute may silently choose among outlets.
                for cluster, attribute, required in ((6, 0, True), (144, 8, False), (145, 1, False)):
                    matches = [key for key in attributes if isinstance(key, str) and
                               re.fullmatch(r'\d+/' + str(cluster) + '/' + str(attribute), key)]
                    if len(matches) > 1 or (required and (len(matches) != 1 or type(attributes[matches[0]]) is not bool)):
                        raise ValueError('The plug endpoint is missing or ambiguous.')
                row = readings([{'node_id': binding['node'], 'available': True, 'attributes': attributes}],
                               one, now=measured_at)[0]
                if not row['available']:
                    raise ValueError('The physical plug identity does not match.')
                row['measured_at'] = row['observed_at']
            except Exception:
                # A cached available=true, socket error or missing device reply is
                # not a new observation. Keep the other mapped devices usable.
                row = readings([], one, now=self.clock())[0]
                row.update(observed_at=None, measured_at=None,
                           issue='The plug could not supply fresh, verified readings.')
            row['source'] = 'Matter device read'
            result.append(row)
        return result


def save_readings(path, observed, mapping):
    """Use cumulative counters where available; only fall back to labelled power estimates."""
    validate_mapping(mapping)
    for row in observed:
        if row.get('available') is not True or row.get('id') not in mapping:
            continue
        args = dict(spark=row['id'], at=row['observed_at'], meter=mapping[row['id']]['fingerprint'])
        if row.get('cumulative_kwh') is not None:
            record(path, **args, kwh=row['cumulative_kwh'])
        elif row.get('watts') is not None:
            record_power(path, **args, watts=row['watts'])
