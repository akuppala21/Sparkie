"""Render protected service bindings for the packaged worker. This command performs no host changes."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from sparkie_sparks.recipe_services import COMPUTE, INSTANCE
from sparkie_sparks.service_definitions import DEFINITIONS, recipe
from service_worker_stage import SETTINGS, STATE, WORKERS


def _bytes(value):
    return (json.dumps(value, sort_keys=True, indent=2) + '\n').encode()


def render(archive, compute, enrollment, output):
    """Use the existing enrolled workspace controller, host identities and SSH accounts."""
    if (
        compute.get('schema') != 1
        or not INSTANCE.fullmatch(compute.get('controller', ''))
        or not INSTANCE.fullmatch(compute.get('hub_machine_id', ''))
        or not isinstance(enrollment, dict)
        or not enrollment
        or not set(enrollment) <= set(COMPUTE)
    ):
        raise ValueError('Supply the protected compute configuration and chosen service placements.')
    archive_hash = hashlib.sha256(Path(archive).read_bytes()).hexdigest()
    authority = compute['controller']
    hub = compute['hub_machine_id']
    catalog = {'schema': 1, 'controller': authority, 'hub_machine': hub, 'nodes': [], 'services': {}}
    files = {}
    for spark, data in enrollment.items():
        (worker,) = [r for r in compute['nodes'] if r['identity']['spark_id'] == spark]
        physical = worker['identity']['machine_id']
        if (
            not INSTANCE.fullmatch(physical)
            or hub == physical
            or not isinstance(data, dict)
            or not data
            or not set(data) <= DEFINITIONS.keys()
            or any(
                not isinstance(p, str)
                or not Path(p).is_absolute()
                or '..' in Path(p).parts
                or any(ord(c) < 32 for c in p)
                for p in data.values()
            )
        ):
            raise ValueError(
                'Use reviewed services, fixed data directories and existing physical compute identities.'
            )
        worker_config = {
            'schema': 1,
            'controller': authority,
            'hub_machine': hub,
            'machine': physical,
            'spark': spark,
            'state_dir': str(STATE),
            'data': data,
        }
        blob = _bytes(worker_config)
        checksum = hashlib.sha256(blob).hexdigest()
        files[spark + '-services.json'] = blob
        catalog['nodes'].append(
            {
                'spark': spark,
                'machine': physical,
                'user': worker['user'],
                'executable': str(WORKERS / archive_hash / 'worker.pyz'),
                'config': str(SETTINGS / checksum / 'worker.json'),
            }
        )
        for name in data:
            item = catalog['services'].setdefault(
                name, {'sparks': [], 'revision': recipe(name, ()).revision}
            )
            item['sparks'].append(spark)
    files['services.json'] = _bytes(catalog)
    output = Path(output)
    output.mkdir(mode=0o700, exist_ok=False)
    if not output.is_absolute():
        output = output.resolve()
    hashes = {}
    for name, blob in files.items():
        path = output / name
        with os.fdopen(os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), 'wb') as stream:
            stream.write(blob)
        hashes[name] = hashlib.sha256(blob).hexdigest()
    return {'archive_sha256': archive_hash, 'files': hashes, 'output': str(output)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for field in ('archive', 'compute', 'enrollment', 'output'):
        parser.add_argument('--' + field, required=True, type=Path)
    args = parser.parse_args()
    print(
        json.dumps(
            render(
                args.archive,
                json.loads(args.compute.read_text()),
                json.loads(args.enrollment.read_text()),
                args.output,
            )
        )
    )
