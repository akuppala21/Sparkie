"""Typed power adapter for the private broker; disconnected until composed.

Default wake sends one On to an observed off plug. The separately qualified
sequence can cut/restart only after durable shutdown and fresh standby proof.
No path installs privilege or changes host access. Spark 1 is never a target.
"""
from datetime import datetime, timezone
import errno
import hashlib
import json
from pathlib import Path
import re
import shlex
import socket
import subprocess
import sys

from .worker_network import physical_ssh_options
from .collector import HOST, USER
from .matter import MatterReader, validate_mapping
from .operations import NotDispatched, intent
from .io_budget import remaining_io

COMPUTE = ('spark2', 'spark3', 'spark4')
MACHINE_ID = re.compile(r'[a-f0-9]{32}\Z')


class PowerMatter:
    """Only fresh observations and a typed On; no model-selected commands."""
    def __init__(self, mapping, *, reader=None):
        validate_mapping(mapping)
        self.mapping = {key: dict(value) for key, value in mapping.items()}
        self.reader = reader or MatterReader()

    def observe(self, spark):
        return self.reader.measurements({spark: self.mapping[spark]})[0]

    def on(self, spark):
        self._switch(spark, True)

    def off_after_shutdown(self, spark):
        """Private qualified sequence only; its caller must verify shutdown first."""
        self._switch(spark, False)

    def _switch(self, spark, on):
        if spark not in COMPUTE or self.mapping[spark].get('read_only', False):
            raise NotDispatched('This Spark plug cannot be switched.')
        binding = self.mapping[spark]
        attrs = self.reader._ask('read_attribute', {'node_id': binding['node'], 'attribute_path': ['0/40/18', '*/6/0']})
        if not isinstance(attrs, dict) or len(attrs) > 128:
            raise NotDispatched('The plug identity could not be checked.')
        uid = attrs.get('0/40/18')
        switches = [key for key in attrs if isinstance(key, str) and re.fullmatch(r'\d+/6/0', key)]
        if (not isinstance(uid, str) or hashlib.sha256(uid.encode()).hexdigest() != binding['fingerprint']
                or len(switches) != 1 or type(attrs[switches[0]]) is not bool):
            raise NotDispatched('The plug identity or switch is ambiguous.')
        if attrs[switches[0]] is on:
            return
        endpoint = int(switches[0].split('/')[0])
        if not 0 <= endpoint < 65535:
            raise NotDispatched('The plug switch endpoint is invalid.')
        # A lost reply must be observed before another action; no case-name retry.
        self.reader._ask('device_command', {'node_id': binding['node'], 'endpoint_id': endpoint,
            'cluster_id': 6, 'command_name': 'on' if on else 'off', 'payload': {}})


class PowerTransport:
    def __init__(self, *, runner=subprocess.run, connect=socket.create_connection, activity_policies=None):
        self.runner = runner
        self.connect = connect
        self.activity_policies = activity_policies or {}

    def activity(self, node, hub_machine_id):
        row = self.request(node, hub_machine_id, 'activity')
        blockers = row.get('blockers')
        return blockers if row.get('status') == 'observed' and isinstance(blockers, list) and all(
            isinstance(value, str) and len(value) <= 256 for value in blockers) else None

    def reachable(self, node):
        """TCP reachability only; an SSH/auth/identity failure is not disappearance."""
        timeout = remaining_io(3)
        try:
            with self.connect((node['address'], 22), timeout=timeout):
                return True
        except (TimeoutError, ConnectionRefusedError):
            return False
        except OSError as exc:
            # Host-unreachable is a failed TCP probe, never shutdown proof by
            # itself. The qualified sequence still requires its recorded
            # shutdown and fresh, sustained standby meter observations.
            return False if exc.errno == errno.EHOSTUNREACH else None

    def request(self, node, hub_machine_id, mode):
        request = {'mode': mode, 'spark': node['id'], 'hostname': node['hostname'],
                   'machine_id': node['machine_id'], 'hub_machine_id': hub_machine_id}
        if mode in ('sleep', 'activity') and node['id'] in self.activity_policies:
            request['activity_policy'] = self.activity_policies[node['id']]
        payload = json.dumps(request)
        source = Path(__file__).with_name('power_worker.py').read_text()
        if node.get('local', False):
            args = [sys.executable, '-I', '-c', source, payload]
        else:
            args = ['ssh', *physical_ssh_options(node['address']),
                    node['user'] + '@' + node['address'], 'python3 -I -c ' + shlex.quote(source) + ' ' + shlex.quote(payload)]
        result = self.runner(args, capture_output=True, text=True, timeout=remaining_io(55), check=False)
        if result.returncode or len(result.stdout) > 16384:
            raise RuntimeError('The Spark power result could not be checked.')
        row = json.loads(result.stdout)
        if not isinstance(row, dict) or row.get('status') not in ('refused', 'observed', 'sent', 'uncertain'):
            raise RuntimeError('The Spark returned an invalid power result.')
        if row['status'] != 'refused' and (row.get('machine_id') != node['machine_id'] or row.get('hostname') != node['hostname']):
            raise RuntimeError('The physical Spark identity did not match.')
        return row


class FleetPower:
    def __init__(self, store, nodes, mapping, *, hub_machine_id, matter=None, transport=None,
                 activity=None, shutdown_observer=None, recovery_ready=(), clock=None, policy_authorizer=None,
                 qualification=None, owner_authorizer=None):
        if not isinstance(hub_machine_id, str) or not MACHINE_ID.fullmatch(hub_machine_id):
            raise ValueError('Configure Spark 1’s verified physical identity.')
        if not isinstance(nodes, list) or not 1 <= len(nodes) <= 3:
            raise ValueError('Power controls need a verified compute inventory.')
        identities = set()
        self.nodes = {}
        for node in nodes:
            if not isinstance(node, dict) or node.get('id') not in COMPUTE or node['id'] in self.nodes:
                raise ValueError('Power controls cannot target Spark 1 or duplicate a Spark.')
            machine = node.get('machine_id')
            if not isinstance(machine, str) or not MACHINE_ID.fullmatch(machine) or machine == hub_machine_id or machine in identities:
                raise ValueError('Each compute Spark needs its own verified physical identity.')
            for key, pattern in (('hostname', HOST), ('address', HOST), ('user', USER)):
                if not isinstance(node.get(key), str) or not pattern.fullmatch(node[key]):
                    raise ValueError('Use a verified Spark address, hostname and account.')
            if type(node.get('local', False)) is not bool or node['hostname'] in ('hub-host.invalid', 'spark1'):
                raise ValueError('Power controls cannot use the hub identity.')
            identities.add(machine)
            self.nodes[node['id']] = dict(node)
        validate_mapping(mapping)
        self.mapping = {key: dict(value) for key, value in mapping.items()}
        self.store, self.hub_machine_id = store, hub_machine_id
        self.matter = matter or PowerMatter(mapping)
        self.transport = transport or PowerTransport()
        self.activity, self.shutdown_observer = activity, shutdown_observer
        if policy_authorizer is not None and not callable(policy_authorizer):
            raise ValueError('Power policy needs a trusted receipt verifier.')
        self.policy_authorizer = policy_authorizer
        if owner_authorizer is not None and not callable(owner_authorizer):
            raise ValueError('Power owner authority needs a trusted current-binding verifier.')
        self.owner_authorizer = owner_authorizer
        self.recovery_ready = frozenset(recovery_ready)
        if not self.recovery_ready.issubset(self.nodes):
            raise ValueError('Recovery qualification must name configured compute Sparks.')
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self.sequence = None
        if qualification is not None:
            from .power_sequence import PowerSequence
            self.sequence = PowerSequence(self, qualification)

    def capabilities(self):
        result = {}
        for spark in self.nodes:
            wake = spark in self.mapping and not self.mapping[spark].get('read_only', False)
            sleep = wake and spark in self.recovery_ready and callable(self.activity) and callable(self.shutdown_observer)
            qualified = self.sequence is not None and spark in self.sequence.qualification
            sleep = sleep or (wake and qualified and callable(self.activity))
            result[spark] = {'wake': wake, 'sleep': sleep, 'hard_cut': False,
                'sleep_message': 'Clean shutdown only; the plug stays on.' if sleep else
                                 'Sleep needs verified recovery, activity checks and clean-shutdown observation.',
                'hard_cut_message': 'Cutting plug power has not been qualified and is unavailable.'}
            if qualified:
                result[spark].update(hard_cut=True,
                    sleep_message='Normal shutdown, verified standby, then plug off. Requested work turns it on again.',
                    hard_cut_message='Plug off is allowed only after this Spark’s qualified shutdown and fresh standby checks.')
        return result

    def actions_for(self, spark):
        row = self.capabilities().get(spark, {})
        return tuple(action for action in ('wake', 'sleep') if row.get(action) is True)

    def description(self, target):
        if (target['action'] == 'sleep' and self.sequence is not None
                and target['spark'] in self.sequence.qualification):
            return ('Shut down Spark ' + target['spark'][-1] + ' only if its work is safely idle, '
                    'verify sustained standby, then switch its plug off. Requested work can wake it.')
        return None

    def cached_message(self, row):
        """Render recorded facts only. Status never probes a Spark or plug."""
        target = row['intent']
        if target['action'] not in ('wake', 'sleep') or self.sequence is None:
            return None
        recorded = self.sequence._get(row['id'])
        if recorded is None:
            return None
        if row['state'] == 'succeeded':
            if target['action'] == 'sleep' and recorded['phase'] == 'off' and recorded['off_observed_at'] is not None:
                return 'Normal shutdown, sustained standby and plug off were verified.'
            if target['action'] == 'wake' and recorded['phase'] == 'ready':
                return 'The expected Spark was observed answering with Docker ready.'
        if row['state'] in ('dispatching', 'uncertain'):
            return {'shutdown_sent': 'Normal shutdown was requested. Standby is still being checked.',
                    'waiting_standby': 'The prior shutdown is recorded. Fresh standby is still being checked.',
                    'standby': 'Sustained standby was observed. The next authorized power step is pending.',
                    'cut_sent': 'Plug off was requested. Its result is still being checked; it will not be repeated.',
                    'off': 'Plug off was observed. Waiting before the authorized wake step.',
                    'on_sent': 'Power on was requested. Waiting for the expected Spark and Docker.'}.get(recorded['phase'])
        return None

    def _target(self, target):
        if not isinstance(target, dict):
            raise ValueError('Use one exact configured compute Spark power action.')
        value = intent(target.get('action'), target.get('spark'))
        if value['action'] not in ('wake', 'sleep') or value != target or value['spark'] not in self.nodes:
            raise ValueError('Use one exact configured compute Spark power action.')
        return value, self.nodes[value['spark']]

    def _approved(self, operation, target, *, continuing=False):
        remaining_io(1)  # Expired maintenance cannot send another effect.
        row = self.store.get(operation)
        if (row['state'] not in (('dispatching', 'uncertain') if continuing else ('dispatching',))
                or row['intent'] != target or row['approved_at'] is None
                or row['approved_channel'] not in ('web', 'telegram') or row['cancel_requested']):
            raise NotDispatched('This power action has no active exact owner confirmation.')
        if callable(self.owner_authorizer) and self.owner_authorizer(row) is not True:
            raise NotDispatched('Owner access changed; no further power effect was sent.')
        self._claimed(operation, target)

    def _claimed(self, operation, target):
        with self.store._db() as db:
            claim = db.execute('SELECT operation FROM claims WHERE spark=?', (target['spark'],)).fetchone()
        if claim is None or claim[0] != operation:
            raise NotDispatched('This power action does not hold its Spark.')

    def _fresh(self, value):
        try:
            stamp = datetime.fromisoformat(value)
            age = (self.clock() - stamp).total_seconds()
            return stamp.tzinfo is not None and -5 <= age <= 30
        except (ValueError, TypeError):
            return False

    def _plug(self, spark):
        row = self.matter.observe(spark)
        if (not isinstance(row, dict) or row.get('id') != spark or row.get('available') is not True
                or row.get('source') != 'Matter device read' or type(row.get('on')) is not bool
                or row.get('measured_at') != row.get('observed_at') or not self._fresh(row.get('measured_at'))):
            raise RuntimeError('The plug has no fresh verified device reading.')
        return row

    def _machine(self, node):
        row = self.transport.request(node, self.hub_machine_id, 'inspect')
        if (not isinstance(row, dict) or row.get('status') != 'observed' or
                (row.get('hostname'), row.get('machine_id')) != (node['hostname'], node['machine_id'])):
            raise RuntimeError('The expected physical Spark is not answering.')
        return row

    def dispatch(self, operation, target):
        self._dispatch(operation, target, self._approved)

    def dispatch_policy(self, operation, target):
        """Private controller receipt only; never a model or owner substitute."""
        def authorized(operation, target):
            remaining_io(1)
            if not callable(self.policy_authorizer) or self.policy_authorizer(operation, target) is not True:
                raise NotDispatched('No current admitted-work or idle-policy receipt authorizes this action.')
            self._claimed(operation, target)
        self._dispatch(operation, target, authorized)

    def _dispatch(self, operation, target, authorize):
        target, node = self._target(target)
        authorize(operation, target)
        spark, action = target['spark'], target['action']
        if not self.capabilities()[spark][action]:
            raise NotDispatched('This power action has not been qualified for this Spark.')
        if self.sequence is not None and spark in self.sequence.qualification:
            self.sequence.advance(operation, target, authorize)
            return
        try:
            plug = self._plug(spark)
        except Exception:
            raise NotDispatched('The plug has no fresh verified reading. Nothing was sent.') from None
        if action == 'wake':
            if plug['on']:
                try:
                    ready = self._machine(node)
                except Exception:
                    raise NotDispatched('The plug is on but the Spark is not answering. Its power was not cycled.') from None
                if ready.get('docker_ready') is not True:
                    raise NotDispatched('The Spark has power but Docker is not ready. Its power was not cycled.')
                return
            authorize(operation, target)
            self.matter.on(spark)
            return
        try:
            machine = self._machine(node)
            blockers = self.activity(node)
        except Exception:
            raise NotDispatched('The Spark’s activity could not be checked. Nothing was shut down.') from None
        if plug['on'] is not True or machine.get('docker_ready') is not True or machine.get('workloads') != []:
            raise NotDispatched('The Spark is busy or its workload state is unknown. Nothing was shut down.')
        if not isinstance(blockers, list) or blockers:
            raise NotDispatched('The Spark is busy or its activity cannot be checked. Nothing was shut down.')
        authorize(operation, target)
        result = self.transport.request(node, self.hub_machine_id, 'sleep')
        if result.get('status') == 'refused':
            raise NotDispatched('The compute Spark refused shutdown before sending it.')
        # Even a zero systemctl exit is only acceptance. observe() requires the
        # separately qualified clean-shutdown proof; SSH loss cannot supply it.

    def advance(self, operation, target):
        """Private controller continuation; observe/reconcile never send effects."""
        target, node = self._target(target)
        if self.sequence is None or not self.sequence.exists(operation):
            return
        def authorized(operation, target):
            remaining_io(1)
            try:
                self.store.get(operation)
            except ValueError:
                if (not callable(self.policy_authorizer)
                        or self.policy_authorizer(operation, target, continuing=True) is not True):
                    raise NotDispatched('The power policy no longer authorizes continuation.')
                self._claimed(operation, target)
            else:
                self._approved(operation, target, continuing=True)
        authorized(operation, target)
        self.sequence.advance(operation, target, authorized)

    def idle_observation(self, spark):
        """Fresh read only. Running containers and unknown activity stay awake."""
        if spark not in self.nodes:
            raise ValueError('Idle policy cannot target Spark 1 or an unknown Spark.')
        try:
            plug = self._plug(spark)
            if plug['on'] is False:
                return {'state': 'off', 'blockers': []}
            machine = self._machine(self.nodes[spark])
            if machine.get('docker_ready') is not True or not isinstance(machine.get('workloads'), list):
                return {'state': 'unknown', 'blockers': None}
            blockers = self.activity(self.nodes[spark]) if callable(self.activity) else None
            if not isinstance(blockers, list):
                return {'state': 'unknown', 'blockers': None}
            return {'state': 'awake', 'blockers': list(blockers) +
                    (['Running containers keep this Spark awake.'] if machine['workloads'] else [])}
        except Exception:
            return {'state': 'unknown', 'blockers': None}

    def result(self, operation, target):
        target, node = self._target(target)
        if self.sequence is not None and self.sequence.exists(operation):
            return self.sequence.observe(operation, target)
        unknown = {'outcome': 'unknown', 'plug_off_sent': False,
                   'message': 'The result is not verified. No plug-off command was sent.'}
        try:
            plug = self._plug(target['spark'])
            if target['action'] == 'wake':
                machine = self._machine(node) if plug['on'] else None
                if machine and machine.get('docker_ready') is True:
                    return {'outcome': 'succeeded', 'plug_off_sent': False,
                            'message': 'The expected Spark has power, answers and has Docker ready.'}
            elif callable(self.shutdown_observer):
                proof = self.shutdown_observer(operation, node)
                if (isinstance(proof, dict) and proof.get('operation') == operation
                        and proof.get('machine_id') == node['machine_id'] and proof.get('state') == 'clean_shutdown'
                        and self._fresh(proof.get('observed_at')) and plug['on'] is True):
                    return {'outcome': 'succeeded', 'plug_off_sent': False, 'ac_power_on': True,
                            'message': 'Clean OS shutdown was verified. The plug stays on; cutting plug power is unavailable.'}
        except Exception:
            pass
        return unknown

    def observe(self, operation, target):
        return self.result(operation, target)['outcome']
