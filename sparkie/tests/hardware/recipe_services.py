"""Bounded private controller smoke for pre-enrolled compute worker trial directories.

Each invocation exercises the real Unix broker and strict SSH remote worker.
The fixture uses its own controller binding and operations DB. Ports, service
users and every path are supplied by the protected trial configuration, and no
live controller, systemd unit, real sign-in, power or bot settings are changed.
"""

import argparse
import http.client
import json
import os
from pathlib import Path
from threading import Thread
import time
import uuid

from sparkie_sparks.authority import Owner, OwnerBinding
from sparkie_sparks.broker import FleetServer, RemoteControls, private_json
from sparkie_sparks.composition import compose
from sparkie_sparks.endpoint_relay import EndpointRelay
from sparkie_sparks.operations import OperationStore
from sparkie_sparks.service_definitions import ARTIFACTS, MODEL
from sparkie_sparks.service_remote import configured_services


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('method', choices=('start', 'stop', 'check'))
    parser.add_argument('name')
    parser.add_argument('spark')
    args = parser.parse_args()
    conf = private_json(args.config)
    if Path('/etc/machine-id').read_text().strip() != conf['services']['hub_machine']:
        raise ValueError('Wrong physical trial controller.')
    root = args.config.parent
    store = OperationStore(root / 'operations.sqlite')
    owner = Owner(conf['services']['controller'], 'web')
    binding = OwnerBinding(owner.generation, 'fixture-owner', 'fixture-provider', 'fixture-issuer', 47, 47)

    def authorize(operation, target):
        row = store.get(operation)
        return (
            row['intent'] == target
            and row['generation'] == owner.generation
            and row['state'] == 'dispatching'
            and row['approved_at'] is not None
            and not row['cancel_requested']
        )

    services = configured_services(
        store, conf['services'], inventory=conf['inventory'], authorize=authorize
    )
    relay = EndpointRelay(conf['relay'], conf['inventory'])
    controls = compose(
        store, conf['inventory'], services=services, service_relay=relay, binding=lambda: binding
    )
    sock = Path(conf['relay']['directory']) / 'broker.sock'
    with FleetServer(sock, controls, gateway_uid=os.getuid()) as server:
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            rpc = RemoteControls(sock, timeout=185)
            rows = rpc.service_catalog(owner)
            (selected,) = [r for r in rows if r['recipe'] == args.name]
            prior = next((r for r in selected['instances'] if r['spark'] == args.spark and r['held']), None)
            if args.method == 'start':
                assert not prior
                target = dict(
                    action='start_service',
                    spark=args.spark,
                    recipe=args.name,
                    revision=selected['revision'],
                )
            elif args.method == 'stop':
                assert prior
                target = dict(
                    action='stop_service',
                    spark=args.spark,
                    recipe=args.name,
                    revision=selected['revision'],
                    instance=prior['instance'],
                )
            else:
                assert prior
            started = time.monotonic()
            if args.method != 'check':
                pending = rpc.prepare(
                    owner,
                    request_key=uuid.uuid4().hex,
                    request_ref='Disposable service qualification',
                    **target
                )
                assert pending['state'] == 'pending'
                response = rpc.confirm(owner, pending['id'], pending['digest'])
                operation = pending['id']
            else:
                operation = prior['instance']
                response = rpc.check(owner, operation)
            duration = time.monotonic() - started
            result = {
                'recipe': args.name,
                'revision': selected['revision'],
                'spark': args.spark,
                'method': args.method,
                'operation': operation,
                'state': response['state'],
                'duration_seconds': round(duration, 3),
                'timestamp': time.time(),
            }
            if args.method == 'stop':
                assert result['state'] == 'succeeded' and services.endpoint(args.name) is None
                try:
                    rpc.service_route(owner, args.name, prior['instance'])
                except RuntimeError:
                    result['retired_route_refused'] = True
                else:
                    raise AssertionError('Retired service returned a relay.')
                result['instance'] = prior['instance']
                result['logs'] = rpc.service_logs(owner, args.name, prior['instance'])
            elif response['state'] == 'succeeded':
                timings = []
                for _ in range(3):
                    before = time.monotonic()
                    route = rpc.service_route(owner, args.name, operation)
                    timings.append(round(time.monotonic() - before, 3))
                result['service_route_seconds'] = timings
                conn = http.client.HTTPConnection('127.0.0.1', route['port'], timeout=35)
                if args.name == ARTIFACTS:
                    conn.request('GET', '/proof.txt')
                    reply = conn.getresponse()
                    assert (
                        reply.status == 200
                        and reply.read() == ('Artifact served by ' + args.spark + '\n').encode()
                    )
                    result['read'] = 'worker-specific artifact'
                    if args.spark in conf.get('symlink_fixtures', []):
                        conn.request('GET', '/outside')
                        rejected = conn.getresponse()
                        rejected.read()
                        assert rejected.status == 404
                        result['outside_symlink_refused'] = True
                else:
                    conn.request(
                        'POST',
                        '/v1/completions',
                        json.dumps(
                            {'model': MODEL, 'prompt': '2 + 2 =', 'temperature': 0, 'max_tokens': 3}
                        ),
                        {'Content-Type': 'application/json'},
                    )
                    reply = conn.getresponse()
                    completion = json.load(reply)
                    assert (
                        reply.status == 200
                        and completion['model'] == MODEL
                        and completion['usage']['completion_tokens'] > 0
                    )
                    result['read'] = 'verified local completion'
                    result['completion_tokens'] = completion['usage']['completion_tokens']
                conn.close()
                result['instance'] = route['instance']
                result['stable_hub_port'] = route['port']
                result['logs'] = rpc.service_logs(owner, args.name, operation)
            elif response['state'] == 'uncertain':
                try:
                    rpc.service_route(owner, args.name, operation)
                except RuntimeError:
                    result['unready_route_refused'] = True
                else:
                    raise AssertionError('Unverified service returned a relay.')
            spelling = (
                str(time.time_ns()) + '-' + args.name + '-' + args.spark + '-' + args.method + '.json'
            )
            (root / spelling).write_text(json.dumps(result, indent=2) + '\n')
            print(json.dumps(result))
        finally:
            relay.close()
            server.shutdown()
            thread.join(timeout=5)


if __name__ == '__main__':
    main()
