"""Time a matched llama.cpp cache comparison on an allocated workspace server."""
import argparse
from datetime import datetime, timezone
import http.client
import ipaddress
import json
from pathlib import Path
from statistics import median
import time
from urllib.parse import urlsplit


MAX_BYTES = 1024 * 1024
WORKSPACE = Path('/workspace')


def origin(url):
    parts = urlsplit(url)
    if (parts.scheme != 'http' or parts.path not in ('', '/') or parts.query or parts.fragment
            or parts.username is not None or not parts.hostname or '%' in parts.netloc
            or not parts.port or not ipaddress.ip_address(parts.hostname).is_loopback):
        raise ValueError('Supply the allocated HTTP loopback origin with an explicit port.')
    return parts.hostname, parts.port


def save(path, value):
    with path.open('x', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False)
        stream.write('\n')


def exchange(address, route, attempt, body=None):
    # Save exactly the bytes passed to HTTPConnection before the single dispatch.
    wire = None
    if body is not None:
        save(attempt.with_suffix('.request.json'), body)
        wire = attempt.with_suffix('.request.json').read_bytes()
    connection = http.client.HTTPConnection(*address, timeout=30)
    try:
        start = time.perf_counter_ns()
        connection.request('POST' if wire else 'GET', route, wire, {'Content-Type': 'application/json'})
        response = connection.getresponse()
        data = response.read(MAX_BYTES + 1)
        elapsed = time.perf_counter_ns() - start
        with attempt.with_suffix('.response').open('xb') as stream:
            stream.write(data)
        save(attempt.with_suffix('.http.json'), {'status': response.status, 'elapsed_ns': elapsed})
        if (response.status != 200 or len(data) > MAX_BYTES or
                (response.length is not None and response.length != 0)):
            raise ValueError(f'{attempt.name} returned an unsuccessful, incomplete or oversized response')
        parsed = json.loads(data)
        if not isinstance(parsed, dict) or 'error' in parsed:
            raise ValueError(f'{attempt.name} returned an invalid response')
        return parsed
    finally:
        connection.close()


def completion(body, cap, model):
    tokens = body.get('tokens_predicted')
    settings = body.get('generation_settings')
    if (body.get('stop') is not True or body.get('truncated') is not False
            or type(tokens) is not int or not 0 < tokens <= cap or body.get('model') != model
            or not isinstance(settings, dict) or settings.get('temperature') != 0 or settings.get('n_predict') != cap
            or not isinstance(body.get('content'), str) or not body['content']):
        raise ValueError('Incomplete completion or mismatch in the model, sampling or token cap.')
    return body['content'], tokens


def input_tokens(reply, cache, request_id):
    timings = reply.get('timings')
    reused = timings.get('cache_n') if isinstance(timings, dict) else None
    if type(reused) is not int or reused < 0 or (not cache and reused != 0):
        raise ValueError(f'{request_id} has missing or inconsistent cache telemetry.')
    counts = {'reused': reused}
    for key, value in (('processed', timings.get('prompt_n')), ('total', reply.get('tokens_evaluated'))):
        if value is not None:
            if type(value) is not int or value < 0:
                raise ValueError(f'{request_id} has an invalid {key} input token count.')
            counts[key] = value
    if 'total' in counts and (reused > counts['total'] or
            ('processed' in counts and reused + counts['processed'] != counts['total'])):
        raise ValueError(f'{request_id} has inconsistent input token counts.')
    return counts


def audit(directory, prompt, cap, model):
    expected = [f'{n:02d}' for n in range(1, 9)]
    for suffix in ('.request.json', '.response', '.http.json'):
        names = sorted(p.name.removesuffix(suffix) for p in directory.glob('[0-9]*' + suffix))
        if names != expected:
            raise ValueError('Expected eight complete requests, one warmup and three timings per setting.')
    results = []
    medians = {}
    cached = {}
    timed_inputs = {}
    for offset, cache in ((0, False), (4, True)):
        times = []
        inputs = []
        for index in range(4):
            prefix = directory / expected[offset + index]
            request = json.loads(prefix.with_suffix('.request.json').read_bytes())
            if (request.get('cache_prompt') is not cache or
                    request != dict(prompt=prompt, temperature=0, n_predict=cap, cache_prompt=cache)):
                raise ValueError(f'{prefix.name} differs from the matched request settings.')
            timing = json.loads(prefix.with_suffix('.http.json').read_bytes())
            if timing['status'] != 200 or type(timing['elapsed_ns']) is not int or timing['elapsed_ns'] <= 0:
                raise ValueError(f'{prefix.name} has no successful timed response.')
            reply = json.loads(prefix.with_suffix('.response').read_bytes())
            results.append(completion(reply, cap, model))
            counts = input_tokens(reply, cache, prefix.name)
            if index > 0:
                times.append(timing['elapsed_ns'])
                inputs.append(counts)
        timed_inputs[str(cache).lower()] = inputs
        cached[str(cache).lower()] = [sample['reused'] for sample in inputs]
        medians[str(cache).lower()] = median(times) / 1_000_000
    if len(set(results)) != 1:
        raise ValueError('The completions or generated token counts differ.')
    return dict(median_wall_ms=medians, timed_cached_tokens=cached, timed_input_tokens=timed_inputs,
                completion=results[0][0], generated_tokens=results[0][1],
                requests=8, warmups_per_setting=1, timed_per_setting=3)


def measure(url, project, prompt, cap):
    address = origin(url)
    project = project.resolve(strict=True)
    if not project.is_dir() or WORKSPACE not in project.parents:
        raise ValueError('Use a persistent project directory inside /workspace.')
    if not prompt or len(prompt.encode()) > 16384 or not 1 <= cap <= 4096:
        raise ValueError('Supply a nonempty prompt up to 16 KiB and a token cap of 1 through 4096.')
    directory = project / 'cache-measurement'
    try:
        # The native terminal may use a different uid than the persistent project owner.
        # Preserve the parent directory boundary and honor the terminal’s umask.
        directory.mkdir(mode=0o755)
    except FileExistsError:
        raise ValueError(f'Existing attempt at {directory}. Read its receipts before any new measurement.')
    save(directory / 'plan.json', dict(origin=url, prompt=prompt, n_predict=cap, temperature=0,
         order=['false warmup', 'false timed x3', 'true warmup', 'true timed x3'],
         started_utc=datetime.now(timezone.utc).isoformat()))
    try:
        if exchange(address, '/health', directory / 'health').get('status') != 'ok':
            raise ValueError('The allocated server is unavailable.')
        props = exchange(address, '/props', directory / 'props')
        model = props.get('model_alias') or props.get('model_path')
        if props.get('total_slots') != 1 or not model or not props.get('build_info'):
            raise ValueError('Expected an identified single-slot llama.cpp server.')
        for n in range(1, 9):
            body = dict(prompt=prompt, temperature=0, n_predict=cap, cache_prompt=n > 4)
            reply = exchange(address, '/completion', directory / f'{n:02d}', body)
            completion(reply, cap, model)
        result = audit(directory, prompt, cap, model)
        result.update(status='verified', origin=url, prompt=prompt, n_predict=cap, temperature=0,
                      total_slots=1, model=model, build=props['build_info'],
                      receipt=str(directory / 'result.json'))
        save(directory / 'result.json', result)
        return result
    except (OSError, ValueError, http.client.HTTPException) as exc:
        save(directory / 'failure.json', dict(status='incomplete', error=str(exc)))
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True)
    parser.add_argument('--project', required=True, type=Path)
    parser.add_argument('--prompt', required=True)
    parser.add_argument('--tokens', required=True, type=int)
    args = parser.parse_args()
    try:
        print(json.dumps(measure(args.url, args.project, args.prompt, args.tokens), ensure_ascii=False))
    except (OSError, ValueError, http.client.HTTPException) as error:
        parser.exit(1, f'Measurement unavailable: {error}\n')
