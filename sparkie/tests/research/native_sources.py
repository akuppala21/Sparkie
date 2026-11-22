"""Read public sources through maintained Hermes tools on a compute Spark.

No model, credentials, bot, application listener or live fleet operation is used.
This is an opt-in network qualification, not a unit test or a custom crawler.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import shlex
import shutil
import socket
import sys
import time


SOURCES = {
    'forum': 'https://forums.developer.nvidia.com/t/qwen3-8-27b-nvfp4-on-a-single-dgx-spark-up-to-1m-context-vllm-mtp-measurements/380244',
    'repo': 'https://github.com/hasso5703/alzeo',
}
DOWNLOADS = {
    'forum': 'https://forums.developer.nvidia.com/t/380244.json',
    'repo': 'https://raw.githubusercontent.com/hasso5703/alzeo/main/README.md',
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    args.out = args.out.resolve()
    args.out.mkdir(parents=True, exist_ok=False)
    root = Path(__file__).resolve().parents[2]
    home = args.out / 'hermes-home'
    home.mkdir(mode=0o700)
    config_path = root / 'config/hermes.example.yaml'
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from native_docker_fixture import configure_compute_docker
    from sandbox_cleanup import NativeSandboxCleanup
    configure_compute_docker(home, config_path, network=True)
    shutil.copytree(root / 'plugin', home / 'plugins/sparkie-sparks')
    os.environ.update(HERMES_HOME=str(home), HERMES_DISABLE_LAZY_INSTALLS='1')
    from hermes_cli.config import apply_terminal_config_to_env, load_config_readonly
    apply_terminal_config_to_env(config=load_config_readonly(), override=True)
    from tools import terminal_tool as terminal
    from tools.file_tools import read_file_tool
    from tools.web_tools import web_search_tool
    from tools.bot_desktop import runtime as desktop
    from tools.browser_session_sandbox import create_sandbox_session, stop_sandbox_browser
    from tools.browser_session_cdp import set_live_cdp_override
    from tools.browser_cdp_tool import browser_cdp

    report = {'host': socket.gethostname(), 'hermes': 'v0.23.2',
              'started_at': datetime.now(timezone.utc).isoformat(),
              'scope': 'Native research tool data only; no model synthesis or deployment qualification.',
              'source_config_sha256': hashlib.sha256(config_path.read_bytes()).hexdigest(),
              'config_sha256': hashlib.sha256((home / 'config.yaml').read_bytes()).hexdigest(),
              'fixture_config_sha256': hashlib.sha256((root / 'tests/native_docker_fixture.py').read_bytes()).hexdigest(),
              'cleanup_sha256': hashlib.sha256((root / 'tests/sandbox_cleanup.py').read_bytes()).hexdigest(),
              'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              'dependencies': {name: importlib.metadata.version(name)
                               for name in ('ddgs', 'click', 'lxml', 'primp')},
              'searches': [], 'browser': {}, 'downloads': {}}
    started = time.monotonic()
    session = None
    cleanup = NativeSandboxCleanup(home)

    def save(name, data):
        (args.out / name).write_text(json.dumps(data, indent=2) + '\n')

    try:
        for index, query in enumerate(('site:forums.developer.nvidia.com Qwen DGX Spark DFlash2',
                                       'hasso5703 alzeo Qwen uncensored')):
            stamp = time.monotonic()
            result = json.loads(web_search_tool(query, limit=3))
            save(f'search-{index + 1}.json', result)
            report['searches'].append({'query': query, 'seconds': round(time.monotonic() - stamp, 3),
                                       'success': result.get('success', False),
                                       'urls': [hit['url'] for hit in result.get('data', {}).get('web', [])],
                                       'error': result.get('error')})
        try:
            desktop.start(wait_seconds=25)
            session = create_sandbox_session('sparkie-public-source-check')
            assert session.get('features', {}).get('sandbox') is True, session
            set_live_cdp_override(session['cdp_url'])
            for name, url in SOURCES.items():
                stamp = time.monotonic()
                created = json.loads(browser_cdp('Target.createTarget', {'url': url}, timeout=30))
                target = created.get('result', {}).get('targetId')
                assert target, created
                last = {}
                deadline = time.monotonic() + 25
                while time.monotonic() < deadline:
                    last = json.loads(browser_cdp('Runtime.evaluate', {
                        'expression': 'JSON.stringify({url:location.href,title:document.title,ready:document.readyState,text:document.body?document.body.innerText:""})',
                        'returnByValue': True,
                    }, target_id=target, timeout=10))
                    value = last.get('result', {}).get('result', {}).get('value')
                    if value:
                        body = json.loads(value)
                        if body.get('ready') == 'complete' and len(body.get('text', '')) > 400:
                            break
                    time.sleep(0.5)
                save(f'browser-{name}.json', last)
                value = last.get('result', {}).get('result', {}).get('value')
                body = json.loads(value) if value else {}
                text = body.get('text', '')
                report['browser'][name] = {'url': body.get('url'), 'title': body.get('title'),
                                          'characters': len(text), 'seconds': round(time.monotonic() - stamp, 3),
                                          'original_source_read': body.get('url') == url and len(text) > 1000
                                          and 'NVFP4' in text and ('tensor-parallel-size' if name == 'forum' else 'uncensored') in text,
                                          'technical_terms': [term for term in ('Qwen', 'SGLang', 'DFlash', 'NVFP4') if term.lower() in text.lower()]}
                browser_cdp('Target.closeTarget', {'targetId': target}, timeout=10)
        except Exception as exc:
            report['browser']['error'] = f'{type(exc).__name__}: {exc}'

        # Public first-party JSON and Markdown are ordinary files. Native
        # terminal downloads them; native read_file returns their saved content.
        for name, url in DOWNLOADS.items():
            stamp = time.monotonic()
            path = '/workspace/source-' + name + ('.json' if name == 'forum' else '.md')
            command = shlex.join(['curl', '--fail', '--location', '--max-time', '30', '--max-filesize',
                                  '2097152', '--silent', '--show-error', '--output', path,
                                  '--write-out', '%{http_code} %{url_effective}', url])
            fetched = json.loads(terminal.terminal_tool(command, timeout=40))
            cleanup.capture()
            save(f'download-{name}.json', fetched)
            item = {'seconds': round(time.monotonic() - stamp, 3), 'download': fetched}
            if fetched.get('exit_code') == 0:
                if name == 'forum':
                    # Parse the original Discourse response without an LLM or
                    # third-party extraction service. Preserve author and date.
                    code = ('import json; from pathlib import Path; '
                            'd=json.loads(Path(' + repr(path) + ').read_text()); '
                            'Path("/workspace/forum-posts.txt").write_text(json.dumps({"title":d["title"],'
                            '"posts":[{k:p.get(k) for k in ("username","created_at","post_number","cooked")}'
                            ' for p in d["post_stream"]["posts"]]},indent=2))')
                    parsed = json.loads(terminal.terminal_tool('python3 -c ' + shlex.quote(code), timeout=20))
                    save('parse-forum.json', parsed)
                    path = '/workspace/forum-posts.txt'
                read = json.loads(read_file_tool(path, limit=500))
                save(f'read-{name}.json', read)
                item['read_error'] = read.get('error')
                item['read_characters'] = len(json.dumps(read))
            report['downloads'][name] = item
    finally:
        browser_cleanup_errors = []
        for action in (lambda: set_live_cdp_override(None),
                       lambda: stop_sandbox_browser(session) if session else None, desktop.stop):
            try:
                action()
            except Exception as exc:
                browser_cleanup_errors.append(str(exc))
        report['browser_cleanup_errors'] = browser_cleanup_errors
        report['sandbox_cleanup'] = cleanup.finish()
        report['containers_removed'] = report['sandbox_cleanup']['verified']
        report['elapsed_seconds'] = round(time.monotonic() - started, 3)
        report['passed'] = (all(item['success'] and item['urls'] for item in report['searches'])
                            and len(report['searches']) == 2
                            and all(report['browser'].get(name, {}).get('original_source_read') for name in SOURCES)
                            and all(report['downloads'].get(name, {}).get('download', {}).get('exit_code') == 0
                                    and not report['downloads'][name].get('read_error')
                                    for name in DOWNLOADS)
                            and report['containers_removed'] and not browser_cleanup_errors)
        save('result.json', report)
        print(json.dumps(report))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
