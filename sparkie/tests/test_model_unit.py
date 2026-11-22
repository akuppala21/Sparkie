"""Fixed brain recipe and readiness reject changed identity before reporting ready."""
import hashlib
import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('sparkie_model_unit', ROOT / 'deploy/model_unit.py')
unit = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(unit)
RECORD = ROOT / 'models/main-model.json'


def test_selected_recipe_keeps_exact_engine_args_and_readonly_weights():
    model = json.loads(RECORD.read_text())
    argv = unit.command(RECORD, weights='/verified/models', cache='/private/cache')
    assert argv[argv.index('--model-path'):] == model['reference_launch_arguments']
    assert argv[argv.index('--entrypoint') + 2] == model['candidate_image']
    assert 'type=bind,src=/verified/models,dst=/models,readonly' in argv
    assert '--rm' in argv and '-d' not in argv
    assert 'HF_HUB_OFFLINE=1' in argv and '--memory' in argv
    service = unit.render(RECORD, weights='/verified/models', cache='/private/cache')
    assert 'Restart=on-failure' in service and 'StartLimitBurst=3' in service
    assert 'ExecStartPost=' in service and 'ExecStartPre=' in service
    assert '"stop" "--record"' in service and 'RuntimeDirectoryMode=0700' in service
    assert argv[:5] == ['/usr/bin/docker', '--config', '/run/sparkie-brain/docker-config', '--host', 'unix:///var/run/docker.sock']
    assert 'ExecStart=/usr/bin/env -i PATH=/usr/bin:/bin ' in service


@pytest.mark.parametrize('path', ['relative/models', '/tmp/x,dst=/private', '/tmp/x\nExecStart=/bin/false'])
def test_untrusted_mount_or_service_path_is_rejected(path):
    with pytest.raises(ValueError):
        unit.command(RECORD, weights=path, cache='/private/cache')


def test_changed_model_interface_cannot_silently_become_public(tmp_path):
    data = json.loads(RECORD.read_text())
    args = data['reference_launch_arguments']
    args[args.index('--host') + 1] = '0.0.0.0'
    record = tmp_path / 'model.json'
    record.write_text(json.dumps(data))
    with pytest.raises(ValueError):
        unit.command(record, weights='/verified/models', cache='/private/cache')


@pytest.mark.parametrize('change', ['image', 'manifest', 'stopped'])
def test_health_cannot_qualify_another_or_stopped_container(monkeypatch, change):
    model = json.loads(RECORD.read_text())
    row = {'Config': {'Image': model['candidate_image'], 'Labels': {
        'sparkie.model-manifest-sha256': hashlib.sha256(RECORD.read_bytes()).hexdigest()}}, 'State': {'Running': True}}
    if change == 'image':
        row['Config']['Image'] = 'another-image'
    elif change == 'manifest':
        row['Config']['Labels'] = {}
    else:
        row['State']['Running'] = False
    monkeypatch.setattr(unit, 'inspect_container', lambda *a, **k: row)
    with pytest.raises(RuntimeError):
        unit.wait_ready(RECORD, timeout=1)


def test_stop_checks_identity_then_uses_exact_id_not_reusable_name(monkeypatch):
    model = json.loads(RECORD.read_text())
    row = {'Id': 'a' * 64, 'Config': {'Image': model['candidate_image'], 'Labels': {
        'sparkie.model-manifest-sha256': hashlib.sha256(RECORD.read_bytes()).hexdigest()}}}
    calls = []
    from types import SimpleNamespace
    monkeypatch.setattr(unit, 'inspect_container', lambda *a, **k: row)
    monkeypatch.setattr(unit, 'docker', lambda *a, **k: calls.append(a) or SimpleNamespace(returncode=0))
    assert unit.stop(RECORD)['container'] == 'a' * 64
    assert calls == [('stop', '--time', '45', 'a' * 64)]
    row['Config']['Labels'] = {}
    with pytest.raises(RuntimeError):
        unit.stop(RECORD)
    assert len(calls) == 1
    monkeypatch.setattr(unit, 'inspect_container', lambda *a, **k: None)
    assert unit.stop(RECORD) == {'stopped': False, 'already_absent': True}
    assert len(calls) == 1


def test_observation_strips_all_docker_environment_and_uses_private_empty_config(monkeypatch):
    monkeypatch.setenv('DOCKER_CONTEXT', 'remote')
    monkeypatch.setenv('DOCKER_CUSTOM_HEADERS', 'private-header')
    seen = []
    def run(argv, **kwargs):
        config = Path(argv[2])
        assert config.is_dir() and list(config.iterdir()) == []
        assert argv[3:5] == ['--host', 'unix:///var/run/docker.sock']
        assert not any(key.startswith('DOCKER_') for key in kwargs['env'])
        seen.append(config)
        return object()
    monkeypatch.setattr(unit.subprocess, 'run', run)
    unit.docker('inspect', 'sparkie-main-brain')
    assert not seen[0].exists()


def test_alternate_recipe_reuses_local_wire_contract_and_preverified_files():
    record = ROOT / 'models/alternate-model.json'
    model = json.loads(record.read_text())
    previous = json.loads(RECORD.read_text())
    argv = unit.command(record, weights='/verified/ggufs', cache='/private/cache')
    assert argv[argv.index('--publish') + 1] == '127.0.0.1:32202:8000'
    assert argv[argv.index('--alias') + 1] == previous['served_model_name']
    assert int(argv[argv.index('--ctx-size') + 1]) // int(argv[argv.index('--parallel') + 1]) == 65536
    assert argv[argv.index('--spec-draft-n-max') + 1] == '8'
    assert argv[argv.index('--pull') + 1] == 'never'
    assert model['candidate_image'] in argv
    assert 'type=bind,src=/verified/ggufs,dst=/models,readonly' in argv


def test_alternate_preflight_refuses_changed_weights_before_docker(tmp_path, monkeypatch):
    record = ROOT / 'models/alternate-model.json'
    model = json.loads(record.read_text())
    for role in ('target', 'draft'):
        (tmp_path / model[role]['file']).write_bytes(b'not a verified checkpoint')
    monkeypatch.setattr(unit, 'docker', lambda *a, **k: pytest.fail('Invalid weights must be rejected locally'))
    with pytest.raises(ValueError, match='GGUF target changed'):
        unit.verify_artifacts(record, weights=tmp_path, cache=tmp_path)


def test_operator_probe_requires_the_reviewed_local_model_and_real_generated_tokens(monkeypatch):
    from io import BytesIO
    rows = iter(({'model': 'sparkie-hermes-main',
                  'choices': [{'message': {'role': 'assistant'}}], 'usage': {'completion_tokens': 1}},
                 {'model': 'sparkie-hermes-main',
                  'choices': [{'message': {'role': 'assistant'}}], 'usage': {'completion_tokens': 0}}))

    class Client:
        def open(self, request, *, timeout):
            assert request.full_url == 'http://127.0.0.1:32202/v1/chat/completions'
            assert timeout <= 20 and 'Authorization' not in request.headers
            assert json.loads(request.data)['max_tokens'] == 16
            return BytesIO(json.dumps(next(rows)).encode())

    def opener(handler):
        assert not handler.proxies
        return Client()

    monkeypatch.setattr(unit.urllib.request, 'build_opener', opener)
    unit.probe_inference(RECORD)
    with pytest.raises(RuntimeError, match='valid inference response'):
        unit.probe_inference(RECORD)


def test_readiness_waits_for_docker_create_and_start_before_probing(monkeypatch):
    from io import BytesIO

    model = json.loads(RECORD.read_text())
    config = {'Image': model['candidate_image'], 'Labels': {
        'sparkie.model-manifest-sha256': hashlib.sha256(RECORD.read_bytes()).hexdigest()}}
    observed = iter((
        None,
        {'Config': config, 'State': {'Status': 'created', 'Running': False}},
        {'Config': config, 'State': {'Status': 'running', 'Running': True}},
    ))
    operations = []

    def inspect(name, *, missing_ok):
        assert missing_ok
        row = next(observed)
        operations.append('inspect')
        return row

    class Client:
        def open(self, url, *, timeout):
            path = url.removeprefix('http://127.0.0.1:32202')
            operations.append(path)
            response = BytesIO(json.dumps({'data': [{'id': model['served_model_name']}]}).encode())
            response.status = 200
            return response

    monkeypatch.setattr(unit, 'inspect_container', inspect)
    monkeypatch.setattr(unit.time, 'sleep', lambda delay: None)
    monkeypatch.setattr(unit.urllib.request, 'build_opener', lambda handler: Client())
    assert unit.wait_ready(RECORD)['ready']
    assert operations == ['inspect', 'inspect', 'inspect', '/health', '/v1/models']


def test_observed_container_disappearing_fails_without_waiting_for_replacement(monkeypatch):
    model = json.loads(RECORD.read_text())
    row = {'Config': {'Image': model['candidate_image'], 'Labels': {
        'sparkie.model-manifest-sha256': hashlib.sha256(RECORD.read_bytes()).hexdigest()}},
        'State': {'Status': 'running', 'Running': True}}
    observed = iter((row, None))

    class Client:
        def open(self, url, *, timeout):
            raise unit.urllib.error.URLError('warming up')

    monkeypatch.setattr(unit, 'inspect_container', lambda *a, **k: next(observed))
    monkeypatch.setattr(unit.time, 'sleep', lambda delay: None)
    monkeypatch.setattr(unit.urllib.request, 'build_opener', lambda handler: Client())
    with pytest.raises(RuntimeError, match='disappeared'):
        unit.wait_ready(RECORD)


def test_loopback_preflight_reuses_time_wait_and_rejects_a_live_listener(monkeypatch):
    import socket

    with socket.socket() as listener:
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(('127.0.0.1', 0))
        listener.listen(1)
        address = listener.getsockname()
        monkeypatch.setattr(unit, 'BRAIN_PORT', address[1])
        with pytest.raises(OSError):
            unit.require_free_listener()
        with socket.create_connection(address, timeout=2) as client:
            server, _ = listener.accept()
            with server:
                # The server closes first so its local endpoint enters TIME_WAIT.
                server.shutdown(socket.SHUT_WR)
                assert client.recv(1) == b''
    with socket.socket() as plain, pytest.raises(OSError):
        plain.bind(address)
    unit.require_free_listener()
