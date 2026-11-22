"""Exercise the maintained client through a real loopback HTTP server."""
import http.client
import importlib.util
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
from pathlib import Path
from threading import Thread

import pytest


path = Path(__file__).resolve().parents[1] / 'skills/one-spark-serving-results/scripts/measure_cache.py'
spec = importlib.util.spec_from_file_location('measure_cache', path)
client = importlib.util.module_from_spec(spec)
spec.loader.exec_module(client)


@pytest.fixture
def allocation(tmp_path, monkeypatch):
    requests = []
    responses = {}
    project = tmp_path / 'project'
    project.mkdir()
    monkeypatch.setattr(client, 'WORKSPACE', tmp_path)

    class Handler(BaseHTTPRequestHandler):
        def reply(self, data):
            body = json.dumps(data).encode()
            self.send_response(200)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            data = {'/health': {'status': 'ok'}, '/props': {'total_slots': 1, 'model_alias': 'tiny', 'build_info': 'b1'}}
            self.reply(data[self.path])

        def do_POST(self):
            assert self.path == '/completion'
            requests.append(self.rfile.read(int(self.headers['Content-Length'])))
            if responses.get(len(requests)) == 'disconnect':
                self.close_connection = True
                return
            self.reply(dict(content='fox', tokens_predicted=2, stop=True, truncated=False, model='tiny',
                            timings={'cache_n': 3 if json.loads(requests[-1])['cache_prompt'] else 0},
                            generation_settings={'temperature': 0, 'n_predict': 8}) | responses.get(len(requests), {}))

    with HTTPServer(('127.0.0.1', 0), Handler) as server:
        thread = Thread(target=server.serve_forever, kwargs={'poll_interval': 0.01})
        thread.start()
        try:
            yield f'http://127.0.0.1:{server.server_port}', project, requests, responses
        finally:
            server.shutdown()
            thread.join()


def test_actual_eight_payloads_outputs_and_medians(allocation):
    url, project, requests, _ = allocation
    result = client.measure(url, project, 'a prompt', 8)
    directory = project / 'cache-measurement'
    assert result['status'] == 'verified' and result['completion'] == 'fox'
    assert result['generated_tokens'] == 2 and result == json.loads(Path(result['receipt']).read_bytes())
    assert result['timed_cached_tokens'] == {'false': [0, 0, 0], 'true': [3, 3, 3]}
    assert result['timed_input_tokens']['true'] == [{'reused': 3}] * 3
    assert len(requests) == 8
    assert [json.loads(body)['cache_prompt'] for body in requests] == [False] * 4 + [True] * 4
    for n, body in enumerate(requests, 1):
        assert body == (directory / f'{n:02d}.request.json').read_bytes()
    for setting, numbers in [('false', (2, 3, 4)), ('true', (6, 7, 8))]:
        elapsed = [json.loads((directory / f'{n:02d}.http.json').read_bytes())['elapsed_ns'] for n in numbers]
        assert result['median_wall_ms'][setting] == sorted(elapsed)[1] / 1e6
    with pytest.raises(ValueError, match='Existing attempt'):
        client.measure(url, project, 'a prompt', 8)
    assert len(requests) == 8
    (directory / '05.request.json').unlink()
    with pytest.raises(ValueError, match='eight complete'):
        client.audit(directory, 'a prompt', 8, 'tiny')


@pytest.mark.parametrize('bad', [{'stop': False}, {'model': 'other'}, {'truncated': True}, {'error': 'failed'},
                                  {'generation_settings': {'temperature': 1, 'n_predict': 8}}])
def test_failed_response_stops_and_retains_attempt(allocation, bad):
    url, project, requests, responses = allocation
    responses[3] = bad
    with pytest.raises(ValueError):
        client.measure(url, project, 'fox', 8)
    directory = project / 'cache-measurement'
    assert len(requests) == 3 and (directory / '03.response').exists()
    assert (directory / 'failure.json').exists() and not (directory / 'result.json').exists()
    with pytest.raises(ValueError, match='Existing attempt'):
        client.measure(url, project, 'fox', 8)
    assert len(requests) == 3


def test_reports_eight_reused_and_one_processed_of_nine_input_tokens(allocation):
    url, project, _, responses = allocation
    for n in range(1, 9):
        reused = 8 if n > 4 else 0
        responses[n] = {'tokens_evaluated': 9, 'timings': {'cache_n': reused, 'prompt_n': 9 - reused}}
    result = client.measure(url, project, 'fox', 8)
    assert result['timed_input_tokens'] == {
        'false': [{'reused': 0, 'processed': 9, 'total': 9}] * 3,
        'true': [{'reused': 8, 'processed': 1, 'total': 9}] * 3}
    assert result['timed_cached_tokens']['true'] == [8, 8, 8]
    directory = project / 'cache-measurement'
    receipt = directory / '06.response'
    body = json.loads(receipt.read_bytes())
    body['tokens_evaluated'] = 8
    receipt.write_text(json.dumps(body))
    with pytest.raises(ValueError, match='inconsistent input token counts'):
        client.audit(directory, 'fox', 8, 'tiny')


def test_connection_lost_after_dispatch_preserves_intent_and_blocks_retry(allocation):
    url, project, requests, responses = allocation
    responses[2] = 'disconnect'
    with pytest.raises(http.client.RemoteDisconnected):
        client.measure(url, project, 'fox', 8)
    directory = project / 'cache-measurement'
    assert requests[1] == (directory / '02.request.json').read_bytes()
    assert not (directory / '02.response').exists() and (directory / 'failure.json').exists()
    with pytest.raises(ValueError, match='Existing attempt'):
        client.measure(url, project, 'fox', 8)
    assert len(requests) == 2


def test_server_reports_cache_use_while_disabled(allocation):
    url, project, requests, responses = allocation
    responses[2] = {'timings': {'cache_n': 3}}
    with pytest.raises(ValueError, match='cache telemetry'):
        client.measure(url, project, 'fox', 8)
    assert len(requests) == 8 and not (project / 'cache-measurement/result.json').exists()


def test_disagreeing_outputs_exclude_comparison(allocation):
    url, project, requests, responses = allocation
    responses[8] = {'content': 'other'}
    with pytest.raises(ValueError, match='differ'):
        client.measure(url, project, 'fox', 8)
    assert len(requests) == 8 and not (project / 'cache-measurement/result.json').exists()


@pytest.mark.parametrize('url', ['https://127.0.0.1:1', 'http://example.org:1', 'http://10.0.0.8:1',
                                  'http://127.0.0.1', 'http://a@127.0.0.1:1', 'http://[::1]:1/test'])
def test_rejects_external_or_unscoped_endpoint(url):
    with pytest.raises(ValueError):
        client.origin(url)


def test_project_cannot_escape_workspace(allocation, tmp_path):
    url, project, requests, _ = allocation
    (project / 'outside').symlink_to(tmp_path.parent, target_is_directory=True)
    with pytest.raises(ValueError, match='inside /workspace'):
        client.measure(url, project / 'outside', 'fox', 8)
    assert not requests
