"""One private fleet boundary, shared by native dashboard and Telegram processes.

Linux Unix socket only; filesystem permissions and SO_PEERCRED restrict the
caller to the configured native gateway UID. This is NOT a model-facing RPC
endpoint. Model-run code must stay in the tested native sandbox without this
socket, private state, fleet credentials or host execution. A trusted gateway
verifies the actual owner event before forwarding its process-local context.

No service is installed or socket opened by importing this module.
"""
import argparse
from dataclasses import asdict
import fcntl
import json
import os
from pathlib import Path
import socket
import socketserver
import signal
import stat
import struct
import time

from .authority import Owner, OwnerBinding
from .controls import Controls
from .operations import OperationStore

LIMIT = 32768
RESULT_LIMIT = 65536
PARAMS = {
    'service_catalog': set(), 'service_logs': {'recipe','instance'}, 'service_route': {'recipe','instance'},
    'binding': set(), 'capabilities': set(), 'recent': set(),
    'prepare': {'request_key', 'request_ref', 'action', 'spark', 'container', 'ttl', 'recipe', 'revision', 'instance'},
    'prepare_memory': {'request_key', 'request_ref', 'target', 'literal'},
    'prepare_update': {'request_key', 'request_ref', 'proposal'},
    'propose_update': {'request_key', 'request_ref', 'proposal'},
    'accept_update': {'operation', 'digest'},
    'rollback_update': {'operation', 'digest'},
    'get': {'operation'}, 'confirm': {'operation', 'digest'},
    'cancel': {'operation'}, 'check': {'operation'},
    'bind_notice': {'operation'},
    'bind_card': {'operation', 'chat', 'message'}, 'require_card': {'operation', 'chat', 'message'},
    'propose': {'request_key', 'request_ref', 'action', 'spark', 'container', 'recipe', 'revision', 'instance'},
    'proposal_status': {'operation'},
    'proposal_check': {'operation'},
    'workspace_config': set(), 'workspace_acquire': {'request', 'generation'},
    'workspace_idle': {'task_id', 'workspace_id', 'generation'},
    'workspace_release': {'task_id', 'workspace_id', 'generation'},
    'maintenance': set(),
}
ERRORS = {'permission': PermissionError, 'invalid': ValueError, 'unavailable': RuntimeError}
ERROR_MESSAGES = {
    'permission': 'Owner access or this confirmation is no longer valid.',
    'invalid': 'This fleet request is invalid or unavailable.',
    'unavailable': 'The fleet result could not be checked. Inspect the request before retrying.',
}


def private_json(path):
    """Read a bounded operator file without following a replaced symlink."""
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        mode = os.fstat(stream.fileno())
        private_owner = mode.st_uid in (0, os.geteuid()) and not mode.st_mode & 0o077
        # Administrator-provisioned immutable configuration is readable by the
        # trusted application's primary group. Never accept a user-owned group
        # file or group write: the runtime must not replace its own authority.
        protected_group = (mode.st_uid == 0 and mode.st_gid == os.getegid()
                           and stat.S_IMODE(mode.st_mode) == 0o640)
        if not stat.S_ISREG(mode.st_mode) or not (private_owner or protected_group):
            raise ValueError('The fleet setup must be private or protected administrator configuration.')
        raw = stream.read(LIMIT + 1)
    if len(raw) > LIMIT:
        raise ValueError('The fleet setup is too large.')
    result = json.loads(raw)
    if not isinstance(result, dict):
        raise ValueError('The fleet setup must be an object.')
    return result


def dispatch_request(controls, request, *, workspaces=None, maintenance=None):
    if not isinstance(request, dict) or set(request) != {'method', 'owner', 'params'}:
        raise ValueError('Invalid fleet request.')
    method, params = request['method'], request['params']
    if not isinstance(method, str) or method not in PARAMS or not isinstance(params, dict) or set(params) - PARAMS[method]:
        raise ValueError('Unsupported fleet request.')
    if method == 'maintenance':
        if request['owner'] is not None or not callable(maintenance):
            raise ValueError('Controller maintenance is unavailable.')
        return maintenance()
    if method in ('propose', 'proposal_status', 'proposal_check', 'propose_update'):
        if request['owner'] is not None:
            raise ValueError('Model proposals cannot carry owner confirmation.')
        from .proposals import propose, status, check
        try:
            if method == 'propose_update':
                return controls.propose_update(**params)
            return {'propose': propose, 'proposal_status': status, 'proposal_check': check}[method](controls, **params)
        except TypeError:
            raise ValueError('The Spark proposal is missing required fields.') from None
    if method.startswith('workspace_'):
        if request['owner'] is not None:
            raise ValueError('Native compute requests do not carry owner confirmations.')
        if workspaces is None:
            raise RuntimeError('Compute workspaces are not configured.')
        handlers = {'workspace_config': workspaces.configuration,
                    'workspace_acquire': workspaces.acquire, 'workspace_idle': workspaces.idle,
                    'workspace_release': workspaces.release}
        return handlers[method](**params)
    if method == 'binding':
        if request['owner'] is not None:
            raise ValueError('Invalid owner lookup.')
        return asdict(controls.binding())
    actor = request['owner']
    if not isinstance(actor, dict) or set(actor) != {'generation', 'channel'} or actor['channel'] not in ('web', 'telegram'):
        raise PermissionError('A verified owner event is required.')
    owner = controls.current(Owner(**actor))
    if method in ('bind_card', 'require_card'):
        handler = controls.store.bind_telegram_card if method == 'bind_card' else controls.store.require_telegram_card
    else:
        handler = getattr(controls, method)
    try:
        return handler(owner, **params)
    except TypeError:
        raise ValueError('The fleet request is missing required fields.') from None


class FleetServer(socketserver.ThreadingUnixStreamServer):
    daemon_threads = True
    block_on_close = True

    def __init__(self, path, controls, *, gateway_uid, workspaces=None, maintenance=None):
        if not hasattr(socket, 'SO_PEERCRED') or type(gateway_uid) is not int or gateway_uid < 0:
            raise ValueError('The fleet boundary needs Linux peer identity checks.')
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        parent = path.parent.stat()
        if parent.st_uid != os.geteuid() or parent.st_mode & 0o077:
            raise ValueError('Use an owner-only directory for the private fleet socket.')
        self.controls, self.gateway_uid, self.workspaces = controls, gateway_uid, workspaces
        self.maintenance = maintenance
        self.path = None
        self._lock_fd = os.open(str(path) + '.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            fcntl.flock(self._lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            if path.exists() or path.is_symlink():
                saved = path.lstat()
                if not stat.S_ISSOCK(saved.st_mode) or saved.st_uid != os.geteuid():
                    raise ValueError('The fleet socket path is occupied by an unrelated file.')
                with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as old:
                    old.settimeout(1)
                    try:
                        old.connect(str(path))
                    except ConnectionRefusedError:
                        path.unlink()  # Owned stale socket, under the exclusive process lock.
                    else:
                        raise ValueError('The private fleet connection is already running.')
            super().__init__(str(path), Handler)
            os.chmod(path, 0o600)
            self.path, self.inode = path, path.stat().st_ino
        except BaseException:
            if self._lock_fd is not None:
                os.close(self._lock_fd)
                self._lock_fd = None
            raise

    def server_close(self):
        super().server_close()
        path = getattr(self, 'path', None)
        if path is not None and path.exists() and path.lstat().st_ino == self.inode:
            path.unlink(missing_ok=True)
        if self._lock_fd is not None:
            os.close(self._lock_fd)
            self._lock_fd = None


class Handler(socketserver.StreamRequestHandler):
    timeout = 5

    def handle(self):
        try:
            _, uid, _ = struct.unpack('3i', self.request.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
            if uid != self.server.gateway_uid:
                raise PermissionError('This process cannot use the private fleet connection.')
            raw = self.rfile.readline(LIMIT + 1)
            if len(raw) > LIMIT or not raw.endswith(b'\n'):
                raise ValueError('The fleet request is too large or incomplete.')
            response = {'result': dispatch_request(self.server.controls, json.loads(raw),
                                                  workspaces=self.server.workspaces,
                                                  maintenance=self.server.maintenance)}
        except PermissionError:
            response = {'error': 'permission', 'message': 'Owner access or this confirmation is no longer valid.'}
        except (ValueError, KeyError, TypeError):
            response = {'error': 'invalid', 'message': 'This fleet request is invalid or unavailable.'}
        except Exception:
            # No exception/output interpolation: SSH and setup errors may carry secrets.
            response = {'error': 'unavailable', 'message': 'The fleet result could not be checked. Inspect the request before retrying.'}
        payload = json.dumps(response, allow_nan=False, ensure_ascii=False).encode() + b'\n'
        if len(payload) > RESULT_LIMIT:
            payload = b'{"error":"unavailable","message":"The fleet reply is too large."}\n'
        self.wfile.write(payload)


class RemoteCards:
    def __init__(self, remote): self.remote = remote
    def bind_telegram_card(self, owner, operation, **params):
        return self.remote._call('bind_card', owner, operation=operation, **params)
    def require_telegram_card(self, owner, operation, **params):
        return self.remote._call('require_card', owner, operation=operation, **params)


class RemoteControls:
    def __init__(self, path, *, timeout=65):
        self.path = str(path)
        if not Path(path).is_absolute():
            raise ValueError('Use an absolute private fleet socket path.')
        if type(timeout) not in (int, float) or not 1 <= timeout <= 300:
            raise ValueError('Use a bounded private fleet wait.')
        self.timeout = timeout
        self.store = RemoteCards(self)

    def _call(self, method, owner=None, **params):
        payload = json.dumps({'method': method, 'owner': asdict(owner) if owner else None, 'params': params}).encode() + b'\n'
        if len(payload) > LIMIT:
            raise ValueError('The fleet request is too large.')
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
                connection.settimeout(self.timeout)
                connection.connect(self.path)
                connection.sendall(payload)
                with connection.makefile('rb') as stream:
                    raw = stream.readline(RESULT_LIMIT + 1)
            if len(raw) > RESULT_LIMIT or not raw.endswith(b'\n'):
                raise ValueError('Invalid fleet reply.')
            response = json.loads(raw)
            if not isinstance(response, dict):
                raise ValueError('Invalid fleet reply.')
            if set(response) == {'error', 'message'}:
                error, message = response['error'], response['message']
                if not isinstance(error, str) or error not in ERRORS or not isinstance(message, str) or len(message) > 512:
                    raise ValueError('Invalid fleet reply.')
            elif set(response) == {'result'}:
                expected = type(None) if method in ('bind_card', 'require_card', 'bind_notice') else list if method in ('recent', 'service_catalog', 'service_logs') else dict
                if not isinstance(response['result'], expected):
                    raise ValueError('Invalid fleet reply.')
            else:
                raise ValueError('Invalid fleet reply.')
        except (OSError, ValueError):
            raise RuntimeError('The private fleet connection is unavailable. Check the request before retrying.') from None
        if 'error' in response:
            # Transport errors never supply user-visible text: it may include a
            # credential or raw command output from an incompatible peer.
            raise ERRORS[response['error']](ERROR_MESSAGES[response['error']])
        return response['result']

    def binding(self): return OwnerBinding(**self._call('binding'))
    def propose(self, **params): return self._call('propose', **params)
    def propose_update(self, **params): return self._call('propose_update', **params)
    def proposal_status(self, **params): return self._call('proposal_status', **params)
    def proposal_check(self, **params): return self._call('proposal_check', **params)
    def current(self, owner):
        if not isinstance(owner, Owner) or owner.generation != self.binding().generation:
            raise PermissionError('Owner access changed. Start a new request.')
        return owner
    def service_catalog(self, owner): return self._call('service_catalog', owner)
    def service_logs(self, owner, recipe, instance): return self._call('service_logs', owner, recipe=recipe, instance=instance)
    def service_route(self, owner, recipe, instance=None): return self._call('service_route', owner, recipe=recipe, instance=instance)
    def capabilities(self, owner): return self._call('capabilities', owner)
    def recent(self, owner): return self._call('recent', owner)
    def prepare(self, owner, **params): return self._call('prepare', owner, **params)
    def prepare_memory(self, owner, **params): return self._call('prepare_memory', owner, **params)
    def prepare_update(self, owner, **params): return self._call('prepare_update', owner, **params)
    def accept_update(self, owner, operation, digest): return self._call('accept_update', owner, operation=operation, digest=digest)
    def rollback_update(self, owner, operation, digest): return self._call('rollback_update', owner, operation=operation, digest=digest)
    def get(self, owner, operation): return self._call('get', owner, operation=operation)
    def confirm(self, owner, operation, digest): return self._call('confirm', owner, operation=operation, digest=digest)
    def cancel(self, owner, operation): return self._call('cancel', owner, operation=operation)
    def check(self, owner, operation): return self._call('check', owner, operation=operation)
    def bind_notice(self, owner, operation): return self._call('bind_notice', owner, operation=operation)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    args = parser.parse_args()
    from .collector import load_inventory
    from .composition import compose
    config = private_json(args.config)
    if config.get('schema') != 1:
        parser.error('Unsupported private fleet setup.')
    binding = lambda: OwnerBinding(**private_json(config['owner_binding']))
    binding()  # Invalid enrollment fails before the socket is opened.
    store = OperationStore(config['operations'])
    nodes = load_inventory(config['inventory'])
    power = None
    if 'power' in config:
        from .power import FleetPower, PowerTransport
        from .power_worker import UNIT
        settings = config['power']
        required = {'nodes', 'mapping', 'hub_machine_id'}
        if (not isinstance(settings, dict) or not required <= set(settings)
                or set(settings) - required - {'qualification', 'activity'}
                or not isinstance(settings['nodes'], list) or not settings['nodes']
                or any(spark not in ('spark2', 'spark3', 'spark4') for spark in settings['nodes'])
                or len(set(settings['nodes'])) != len(settings['nodes'])):
            parser.error('Power needs an explicit verified compute inventory and plug mapping.')
        compute = [node for node in nodes if node['id'] in settings['nodes']]
        if len(compute) != len(settings['nodes']):
            parser.error('Every power-enabled Spark must be in the verified inventory.')
        activity = settings.get('activity', {})
        qualification = private_json(settings['qualification']) if settings.get('qualification') else None
        if (not isinstance(activity, dict) or not set(activity) <= set(settings['nodes'])
                or any(not isinstance(value, dict) or set(value) != {'allowed_user_units', 'protected_units'}
                    or any(not isinstance(units, list) or len(units) > 32 or any(
                        not isinstance(unit, str) or not UNIT.fullmatch(unit) for unit in units)
                        for units in value.values()) for value in activity.values())
                or qualification is not None and not set(qualification) <= set(activity)):
            parser.error('Qualified power needs explicit protected activity settings for each compute Spark.')
        transport = PowerTransport(activity_policies=activity)
        power = FleetPower(store, compute, private_json(settings['mapping']), hub_machine_id=settings['hub_machine_id'],
                           transport=transport, qualification=qualification,
                           activity=(lambda node: transport.activity(node, settings['hub_machine_id'])) if activity else None)
    sender = None
    if 'notifications' in config:
        from .notices import NativeTelegramSender
        sender = NativeTelegramSender(config['notifications'])
    # The existing protected native-service binding fixes the profile home.
    # Transport arguments never select a path or another profile.
    memory_home = Path(sender.config['home']) if sender is not None else None
    policy, ensure_awake = None, None
    idle_settings = config.get('idle_policy', {})
    if power is not None and ('compute_config' in config or 'service_config' in config or idle_settings):
        from .idle import IdlePower
        if (not isinstance(idle_settings, dict) or set(idle_settings) - {'revision', 'idle_seconds', 'enabled'}
                or type(idle_settings.get('enabled', False)) is not bool):
            parser.error('Use a protected idle policy with an explicit enabled setting.')
        policy = IdlePower(store, power, revision=idle_settings.get('revision', 'requested-work-v1'),
                           idle_seconds=idle_settings.get('idle_seconds', 1800),
                           allow_sleep=idle_settings.get('enabled') is True)

        def wait_for_wake(get_receipt):
            deadline = time.monotonic() + 150
            while True:
                receipt = get_receipt()
                if receipt['state'] == 'succeeded':
                    return True
                if receipt['state'] == 'failed' or time.monotonic() >= deadline:
                    return False
                policy.advance(receipt['id'])
                time.sleep(1)

        def ensure_awake(allocation):
            return wait_for_wake(lambda: policy.wake(allocation))

    services, relay = None, None
    if 'service_config' in config:
        from .service_remote import configured_services

        def authorize_service(operation, target):
            row = store.get(operation)
            return bool(row['intent'] == target and row['state'] == 'dispatching'
                        and row['approved_at'] is not None and row['approved_channel'] in ('telegram','web')
                        and not row['cancel_requested'] and row['generation'] == binding().generation)

        def wake_service(operation, node):
            return wait_for_wake(lambda: policy.wake_service(operation, node))

        services = configured_services(store, private_json(config['service_config']), inventory=nodes,
            authorize=authorize_service, wake=wake_service if policy else None)
        if 'service_relay' in config:
            from .endpoint_relay import EndpointRelay
            if set(config['service_relay']['ports']) != set(services.recipes):
                parser.error('Configure exactly one relay port per enrolled recipe.')
            relay = EndpointRelay(config['service_relay'], [n for n in nodes if n['id'] in services.nodes])
    updates = None
    if 'application_updates' in config:
        if config['application_updates'] is not True:
            parser.error('Application updates need the reviewed protected steward.')
        from .application_updates import ApplicationUpdates
        updates = ApplicationUpdates(store)
    controls = compose(store, nodes, binding=binding, power=power, memory_home=memory_home,
                       services=services, service_relay=relay, updates=updates)
    workspaces = None
    if 'compute_config' in config:
        from .workspace_service import ComputeService
        compute_settings = private_json(config['compute_config'])
        candidate_order = None
        if config.get('fleet_snapshot'):
            from .placement import AwakeFirst
            candidate_order = AwakeFirst([row['identity']['spark_id'] for row in compute_settings['nodes']],
                                         snapshot=config['fleet_snapshot'])
        workspaces = ComputeService(store, compute_settings, ensure_awake=ensure_awake, candidate_order=candidate_order)

    def maintenance():
        from .io_budget import io_budget
        from .power_maintenance import advance_power
        # Collector waits 240s; cap all fixed transport reads/effects under one
        # 225s request budget, including preceding workspace/policy scans.
        with io_budget(225):
            service_results = services.reconcile_pending() if services else []
            if relay:
                with store._db() as db:
                    active = [r[0] for r in db.execute("SELECT id FROM recipe_service_instances WHERE held=1 AND phase='ready'")]
                relay.prune(active)
            controls.notices.arm()
            workspace_results = workspaces.scan() if workspaces else []
            policy_results = policy.scan() if policy is not None and idle_settings.get('enabled') is True else []
            continued = advance_power(controls, power, policy)
            notices = controls.notices.deliver(sender, view=controls.view) if sender else []
            return {'workspaces': workspace_results, 'power': policy_results, 'continued': continued,
                    'notifications': notices, 'services': service_results}
    def stop(signum, frame):
        raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, stop)
    with FleetServer(config['socket'], controls, gateway_uid=config['gateway_uid'],
                     workspaces=workspaces, maintenance=maintenance) as server:
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            if relay:
                relay.close()


if __name__ == '__main__':
    main()
