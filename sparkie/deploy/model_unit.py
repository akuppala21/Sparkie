"""Render the selected local brain service and check readiness; never install it.

Docker/systemd own the lifecycle. This script adds no agent loop or restart daemon.
The cache and verified model root must be provisioned before candidate approval.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request


def literal(value):
    value = str(value)
    if not value or any(c in value for c in '\n\r"\\%$'):
        raise ValueError('Unsupported service path or setting')
    return '"' + value + '"'


BRAIN_NAME = 'sparkie-main-brain'
BRAIN_HOST = '127.0.0.1'
BRAIN_PORT = 32202
BRAIN_ALIAS = 'sparkie-hermes-main'
BRAIN_CONTEXT = 65536


def selected(record):
    model = json.loads(Path(record).read_text())
    if (model['served_model_name'] != BRAIN_ALIAS
            or model['configured_context_tokens'] != BRAIN_CONTEXT):
        raise ValueError('The reviewed Hermes model name and context must stay aligned.')
    if model['engine'] == 'llama.cpp':
        if not re.fullmatch(r'ghcr.io/ggml-org/llama.cpp@sha256:[a-f0-9]{64}', model['candidate_image']):
            raise ValueError('Use the reviewed llama.cpp image digest.')
        for role in ('target', 'draft'):
            item = model[role]
            if (not re.fullmatch(r'[a-zA-Z0-9._-]+[.]gguf', item['file'])
                    or not re.fullmatch(r'[a-f0-9]{64}', item['sha256'])):
                raise ValueError('Use the exact reviewed local GGUF artifacts.')
        if model['target']['file'] == model['draft']['file']:
            raise ValueError('The target and draft must be distinct files.')
        return model
    if model['engine'] != 'sglang':
        raise ValueError('Unsupported local model engine.')
    if not re.fullmatch(r'lmsysorg/sglang@sha256:[a-f0-9]{64}', model['candidate_image']):
        raise ValueError('The serving image must use its reviewed content digest')
    args = model['reference_launch_arguments']
    fixed = {'--model-path': '/models/target', '--speculative-draft-model-path': '/models/draft',
             '--served-model-name': 'sparkie-hermes-main', '--host': '127.0.0.1', '--port': '32202',
             '--tp-size': '1', '--speculative-algorithm': 'DFLASH',
             '--context-length': str(BRAIN_CONTEXT)}
    for flag, value in fixed.items():
        if args.count(flag) != 1 or args[args.index(flag) + 1] != value:
            raise ValueError('The selected one-Spark local serving interface changed')
    for value in args:
        literal(value)
    return model


def docker_environment():
    return {key: value for key, value in os.environ.items() if not key.startswith('DOCKER_')}


def docker_prefix(config):
    if not Path(config).is_absolute():
        raise ValueError('Use an absolute private empty Docker configuration directory')
    literal(config)
    return ['/usr/bin/docker', '--config', str(config), '--host', 'unix:///var/run/docker.sock']


def docker(*arguments, timeout=10):
    # Every observation/control call gets a new private empty config, with no
    # ambient daemon context, certificates, custom headers or registry settings.
    with tempfile.TemporaryDirectory(prefix='sparkie-brain-docker-') as config:
        return subprocess.run([*docker_prefix(config), *arguments], env=docker_environment(),
                              capture_output=True, text=True, timeout=timeout, check=False)


def inspect_container(name, *, missing_ok=False):
    result = docker('inspect', name)
    if result.returncode == 0:
        return json.loads(result.stdout)[0]
    if missing_ok:
        listing = docker('container', 'ls', '-a', '-q', '--filter', 'name=^/' + name + '$')
        if listing.returncode == 0 and not listing.stdout.strip():
            return None
    raise RuntimeError('The selected brain container is unavailable')


def command(record, *, weights, cache, group=1000, name='sparkie-main-brain', attached=True,
            docker_config='/run/sparkie-brain/docker-config'):
    model = selected(record)
    for path in (weights, cache):
        if not Path(path).is_absolute() or any(c in str(path) for c in ',\n\r'):
            raise ValueError('Use absolute reviewed model/cache paths without mount separators')
        literal(path)
    if type(group) is not int or group < 0 or not re.fullmatch(r'[a-z][a-z0-9-]{2,63}', name):
        raise ValueError('Invalid model service identity')
    digest = hashlib.sha256(Path(record).read_bytes()).hexdigest()
    prefix = [*docker_prefix(docker_config), 'run', *(['--rm'] if attached else ['-d']),
              '--pull', 'never', '--name', name, '--label', 'sparkie.model-manifest-sha256=' + digest,
              '--gpus', 'all']
    if model['engine'] == 'llama.cpp':
        return [*prefix, '--user', f'1000:{group}', '--cap-drop', 'ALL',
                '--security-opt', 'no-new-privileges', '--memory', '96g', '--memory-swap', '96g',
                '--shm-size', '1g', '--pids-limit', '512', '--publish', f'{BRAIN_HOST}:{BRAIN_PORT}:8000',
                '--health-cmd', 'curl -fsS http://127.0.0.1:8000/health || exit 1',
                '--mount', f'type=bind,src={weights},dst=/models,readonly', '--env', 'HOME=/tmp',
                model['candidate_image'], '--model', '/models/' + model['target']['file'],
                '--alias', BRAIN_ALIAS, '--host', '0.0.0.0', '--port', '8000', '--n-gpu-layers', '999',
                '--flash-attn', 'on', '--ctx-size', str(2 * BRAIN_CONTEXT), '--parallel', '2', '--jinja',
                '--reasoning-format', 'deepseek', '--temp', '1.0', '--top-p', '0.95', '--top-k', '20',
                '--min-p', '0', '--metrics', '--spec-type', 'draft-dflash2', '--spec-draft-n-max', '8',
                '--spec-draft-ngl', '999', '--spec-draft-model', '/models/' + model['draft']['file']]
    return [*prefix, '--memory', '100g', '--memory-swap', '100g', '--shm-size', '16g',
            '--ipc', 'host', '--network', 'host', '--cap-drop', 'ALL', '--group-add', str(group),
            '--security-opt', 'no-new-privileges', '-e', 'HF_HUB_OFFLINE=1',
            '-e', 'HF_HUB_DISABLE_TELEMETRY=1', '-e', 'GLOO_SOCKET_IFNAME=lo', '-e', 'NCCL_SOCKET_IFNAME=lo',
            '--mount', f'type=bind,src={weights},dst=/models,readonly',
            '--mount', f'type=bind,src={cache},dst=/cache',
            '-e', 'TORCHINDUCTOR_CACHE_DIR=/cache/inductor', '-e', 'SGLANG_ENABLE_HEALTH_ENDPOINT_GENERATION=0',
            '-e', 'SGLANG_DISTRIBUTED_INIT_METHOD_OVERRIDE=file:///tmp/sglang-rdv',
            '--entrypoint', 'python3', model['candidate_image'], '-m', 'sglang.launch_server',
            *model['reference_launch_arguments']]


def render(record, *, weights, cache, group=1000):
    record = Path(record).resolve()
    argv = command(record, weights=weights, cache=cache, group=group)
    ready = ['/usr/bin/python3', Path(__file__).resolve(), 'wait-ready', '--record', record,
             '--name', 'sparkie-main-brain', '--timeout', '480']
    preflight = ['/usr/bin/python3', Path(__file__).resolve(), 'preflight', '--record', record,
                 '--weights', weights, '--cache', cache, '--group', group, '--name', BRAIN_NAME]
    stop = ['/usr/bin/python3', Path(__file__).resolve(), 'stop', '--record', record,
            '--name', 'sparkie-main-brain']
    return '\n'.join([
        '[Unit]', 'Description=Sparkie selected local brain', 'Requires=docker.service',
        'After=docker.service network-online.target', 'StartLimitIntervalSec=1800', 'StartLimitBurst=3',
        '', '[Service]', 'Type=exec', 'ExecStartPre=' + ' '.join(map(literal, preflight)),
        # env replaces itself with Docker; systemd still owns the attached
        # process. No inherited Docker environment can redirect this command.
        'ExecStart=/usr/bin/env -i PATH=/usr/bin:/bin ' + ' '.join(map(literal, argv)),
        'ExecStartPost=' + ' '.join(map(literal, ready)),
        'ExecStop=' + ' '.join(map(literal, stop)),
        'RuntimeDirectory=sparkie-brain', 'RuntimeDirectoryMode=0700',
        'Restart=on-failure', 'RestartSec=15', 'TimeoutStartSec=540', 'TimeoutStopSec=90',
        'NoNewPrivileges=yes', 'UMask=0077', '', '[Install]', 'WantedBy=multi-user.target', '',
    ])


def verify_artifacts(record, *, weights, cache, group=1000, name=BRAIN_NAME):
    model = selected(record)
    command(record, weights=weights, cache=cache, group=group, name=name)
    weights, cache = Path(weights), Path(cache)
    if not cache.is_dir():
        raise ValueError('Provision the reviewed model cache directory first.')
    if model['engine'] == 'llama.cpp':
        for role in ('target', 'draft'):
            artifact = weights / model[role]['file']
            if artifact.is_symlink() or not artifact.is_file():
                raise ValueError(f'The verified GGUF {role} must be a real file.')
            with artifact.open('rb') as stream:
                if hashlib.file_digest(stream, 'sha256').hexdigest() != model[role]['sha256']:
                    raise ValueError(f'The verified GGUF {role} changed.')
    else:
        provenance = json.loads((weights / 'verified.json').read_text())
        expected = {'target': (model['repository'], model['revision']),
                    'draft': (model['speculative_profile']['draft_repository'],
                              model['speculative_profile']['draft_revision'])}
        saved = {row['folder']: (row['repository'], row['revision']) for row in provenance['models']}
        if any(saved.get(folder) != identity or not (weights / folder / 'config.json').is_file()
               for folder, identity in expected.items()):
            raise ValueError('Provision the previously verified selected target and draft first.')
    if docker('image', 'inspect', model['candidate_image']).returncode:
        raise RuntimeError('The pinned local engine image is unavailable')
    return model


def require_free_listener():
    # Reusing the local endpoint must tolerate TCP TIME_WAIT from the previous
    # engine. listen() still rejects an occupied service or dual bind.
    with socket.socket() as reservation:
        reservation.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        reservation.bind((BRAIN_HOST, BRAIN_PORT))
        reservation.listen(1)


def preflight(record, *, weights, cache, group=1000, name=BRAIN_NAME):
    model = verify_artifacts(record, weights=weights, cache=cache, group=group, name=name)
    if inspect_container(name, missing_ok=True) is not None:
        raise RuntimeError('The model container name is occupied; inspect it before restarting')
    require_free_listener()
    return {'prepared': True, 'model': model['served_model_name']}


def require_identity(row, record, model):
    digest = hashlib.sha256(Path(record).read_bytes()).hexdigest()
    if (row['Config']['Image'] != model['candidate_image']
            or row['Config'].get('Labels', {}).get('sparkie.model-manifest-sha256') != digest):
        raise RuntimeError('The running brain does not match this candidate')


def stop(record, *, name='sparkie-main-brain'):
    model = selected(record)
    if not re.fullmatch(r'[a-z][a-z0-9-]{2,63}', name):
        raise ValueError('Invalid model service identity')
    row = inspect_container(name, missing_ok=True)
    if row is None:
        return {'stopped': False, 'already_absent': True}
    require_identity(row, record, model)
    identifier = row.get('Id')
    if not isinstance(identifier, str) or not re.fullmatch('[a-f0-9]{64}', identifier):
        raise RuntimeError('The selected brain has no exact container identity')
    if docker('stop', '--time', '45', identifier, timeout=60).returncode:
        raise RuntimeError('The selected brain stop could not be confirmed')
    return {'stopped': True, 'container': identifier}


def wait_ready(record, *, name='sparkie-main-brain', timeout=480):
    model = selected(record)
    if not re.fullmatch(r'[a-z][a-z0-9-]{2,63}', name) or not 1 <= timeout <= 600:
        raise ValueError('Invalid readiness target or bounded timeout')
    local_http = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    started = time.monotonic()
    seen_container = seen_running = False
    while time.monotonic() - started < timeout:
        # Type=exec allows ExecStartPost before Docker has created/started its container.
        row = inspect_container(name, missing_ok=True)
        if row is None:
            if seen_container:
                raise RuntimeError('The selected brain disappeared before becoming ready')
        else:
            require_identity(row, record, model)
            seen_container = True
            state = row['State']
            if state['Running']:
                seen_running = True
                try:
                    with local_http.open(f'http://{BRAIN_HOST}:{BRAIN_PORT}/health', timeout=3) as health:
                        healthy = health.status == 200
                    with local_http.open(f'http://{BRAIN_HOST}:{BRAIN_PORT}/v1/models', timeout=3) as response:
                        models = json.load(response)
                    data = models.get('data') if isinstance(models, dict) else None
                    if healthy and isinstance(data, list) and any(
                            isinstance(entry, dict) and entry.get('id') == model['served_model_name'] for entry in data):
                        return {'ready': True, 'model': model['served_model_name'],
                                'seconds': round(time.monotonic() - started, 3)}
                except (urllib.error.URLError, TimeoutError, OSError, ValueError):
                    pass
            elif seen_running or state.get('Status') != 'created':
                raise RuntimeError('The selected brain stopped before becoming ready')
        time.sleep(min(3, max(0, timeout - (time.monotonic() - started))))
    raise TimeoutError('The selected brain did not become ready; inspect its service without asking the model')


def probe_inference(record):
    """Require an actual local inference response before an operator marks a switch ready."""
    model = selected(record)['served_model_name']
    request = urllib.request.Request(
        f'http://{BRAIN_HOST}:{BRAIN_PORT}/v1/chat/completions',
        data=json.dumps({'model': model, 'messages': [{'role': 'user', 'content': 'Reply with OK.'}],
                         'max_tokens': 16, 'temperature': 0}).encode(),
        headers={'Content-Type': 'application/json'})
    client = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with client.open(request, timeout=20) as response:
            result = json.loads(response.read(65536))
        if (isinstance(result, dict) and result.get('model') == model
                and result['choices'][0]['message']['role'] == 'assistant'
                and result['usage']['completion_tokens'] > 0):
            return
    except (urllib.error.URLError, OSError, ValueError, KeyError, TypeError, IndexError):
        pass
    raise RuntimeError('The reviewed local brain did not return a valid inference response.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['render', 'preflight', 'wait-ready', 'stop'])
    parser.add_argument('--record', type=Path, required=True)
    parser.add_argument('--weights', type=Path)
    parser.add_argument('--cache', type=Path)
    parser.add_argument('--group', type=int, default=1000)
    parser.add_argument('--name', default='sparkie-main-brain')
    parser.add_argument('--timeout', type=int, default=480)
    args = parser.parse_args()
    if args.action in ('render', 'preflight'):
        if args.weights is None or args.cache is None:
            parser.error('Rendering needs the verified model root and compilation-cache path')
        if args.action == 'render':
            print(render(args.record, weights=args.weights, cache=args.cache, group=args.group))
        else:
            print(json.dumps(preflight(args.record, weights=args.weights, cache=args.cache, group=args.group, name=args.name)))
    elif args.action == 'stop':
        print(json.dumps(stop(args.record, name=args.name)))
    else:
        print(json.dumps(wait_ready(args.record, name=args.name, timeout=args.timeout)))
