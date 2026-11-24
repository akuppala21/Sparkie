"""Run the fleet Webapp browser check with a private loopback Hermes fixture."""
import argparse
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
from urllib.error import URLError
from urllib.request import ProxyHandler, build_opener

from ruamel.yaml import YAML

from run_sparks import browser_tools


def run(baseline, assets, output):
    output = output.resolve()
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    browser, modules = browser_tools()
    with tempfile.TemporaryDirectory(prefix='sparkie-webapp-owner-') as tmp:
        home = Path(tmp) / '.hermes'
        home.mkdir(mode=0o700)
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0))
            port = probe.getsockname()[1]
        yaml = YAML()
        config = yaml.load((baseline / 'extension/config/hermes.example.yaml').read_text())
        config['webapp'] = {'enabled': True, 'port': port, 'host': '127.0.0.1'}
        config['plugins']['enabled'] = ['sparkie-sparks', 'sparkie-recipes']
        config['auxiliary'].setdefault('title_generation', {})['enabled'] = False
        with (home / 'config.yaml').open('w') as handle:
            yaml.dump(config, handle)
        env = {**os.environ, 'HOME': tmp, 'HERMES_HOME': str(home),
               'HERMES_CONFIG_BACKEND': 'file', 'HERMES_ENABLE_PROJECT_PLUGINS': '0',
               'HERMES_DISABLE_LAZY_INSTALLS': '1', 'HF_HUB_OFFLINE': '1',
               'HERMES_WEBAPP_DIST': str(assets), 'HERMES_WEB_DIST': str(baseline/'dashboard'),
               'HERMES_BUNDLED_PLUGINS': str(baseline/'bundled-plugins'),
               'PYTHONPATH': os.pathsep.join(str(baseline / part) for part in ('extension/src', 'hermes')),
               'SPARKIE_TEST_URL': f'http://127.0.0.1:{port}/', 'SPARKIE_TEST_CHROME': browser,
               'NODE_PATH': modules, 'SPARKIE_BROWSER_OUTPUT': str(output)}
        gateway = None
        with (Path(tmp) / 'gateway.log').open('w') as log:
            try:
                gateway = subprocess.Popen([sys.executable, '-m', 'hermes_cli.main', 'gateway', 'run'],
                                           env=env, cwd=tmp, stdout=log, stderr=subprocess.STDOUT)
                local = build_opener(ProxyHandler({}))
                for _ in range(180):
                    if gateway.poll() is not None:
                        raise RuntimeError('The isolated gateway stopped before opening its Webapp.')
                    try:
                        with local.open(env['SPARKIE_TEST_URL'], timeout=2) as response:
                            if response.headers.get_content_type() == 'text/html':
                                break
                    except (OSError, URLError):
                        pass
                    time.sleep(0.25)
                else:
                    raise RuntimeError('The isolated Webapp did not listen within 45 seconds.')
                # Session belongs only to this throwaway home. Pass it in memory,
                # including to each new browser context. Never log the credential.
                from gateway.webapp_listener import browser_session_token
                env['HERMES_WEBAPP_SESSION'] = browser_session_token(home)
                subprocess.run(['node', Path(__file__).with_name('webapp_sparks.mjs')],
                               env=env, check=True, timeout=150)
            finally:
                if gateway is not None:
                    gateway.terminate()
                    try:
                        gateway.wait(timeout=8)
                    except subprocess.TimeoutExpired:
                        gateway.kill()
                        gateway.wait()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('baseline', 'assets', 'output'):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    run(args.baseline.resolve(strict=True), args.assets.resolve(strict=True), args.output)
