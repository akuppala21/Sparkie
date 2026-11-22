"""Run with pinned Hermes + selected local model on a compute Spark.

This qualifies the new read tools, not the full application. It creates its own
Hermes home and explicit observations. No real fleet credentials or bot is used.
Raw replies are retained for semantic review rather than scored by fragile prose.
"""

import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import sys
import time
import uuid
from urllib.parse import urlparse


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--base-url', default='http://127.0.0.1:32202/v1')
    parser.add_argument('--configured-runtime', action='store_true',
                        help='Use the candidate native platform toolset and exclusions instead of only the two read tools.')
    parser.add_argument('--platform', choices=('cli', 'telegram'), default='telegram')
    args = parser.parse_args()
    url = urlparse(args.base_url)
    if url.scheme != 'http' or url.hostname != '127.0.0.1' or url.username or url.password or url.path != '/v1':
        parser.error('Use the isolated loopback model endpoint.')
    if socket.gethostname() not in ('compute2-host.invalid', 'compute3-host.invalid', 'compute4-host.invalid'):
        parser.error('Run behavior checks on a compute Spark.')
    args.out.mkdir(parents=True, exist_ok=False)
    root = Path(__file__).resolve().parents[2]
    home = args.out / 'hermes-home'
    shutil.copytree(root / 'plugin', home / 'plugins' / 'sparkie-sparks')
    if args.configured_runtime:
        shutil.copyfile(root / 'config/hermes.example.yaml', home / 'config.yaml')
    else:
        (home / 'config.yaml').write_text('plugins:\n  enabled: [sparkie-sparks]\n')
    for key in list(os.environ):
        if key.endswith(('_API_KEY', '_TOKEN', '_PASSWORD', '_SECRET')):
            os.environ.pop(key)
    os.environ.update(HERMES_HOME=str(home), HERMES_DISABLE_LAZY_INSTALLS='1', HF_HUB_OFFLINE='1',
                      NO_PROXY='*', SPARKIE_FLEET_SNAPSHOT=str(args.out / 'fleet-snapshot.json'),
                      SPARKIE_ENERGY_DATABASE=str(args.out / 'energy.sqlite'))

    def audit(event, values):
        if event == 'socket.connect':
            address = values[1]
            if not isinstance(address, tuple) or address[:2] != ('127.0.0.1', url.port or 80):
                raise PermissionError('This read-tool check permits only its local model endpoint.')
    sys.addaudithook(audit)
    from sparkie_sparks.energy import record
    from run_agent import AIAgent
    from hermes_cli.plugins import get_plugin_manager
    from tools.registry import registry
    from hermes_cli.config import load_config_readonly, apply_terminal_config_to_env
    config = load_config_readonly()
    apply_terminal_config_to_env(config=config, override=True)
    enabled = config['platform_toolsets'][args.platform] if args.configured_runtime else ['sparks']
    disabled = config.get('agent', {}).get('disabled_toolsets', []) if args.configured_runtime else []

    now = datetime.now(timezone.utc)
    snapshot = {'schema': 1, 'sparks': [
        {'id': 'spark1', 'state': 'online', 'observed_at': now.isoformat()},
        {'id': 'spark2', 'state': 'off', 'observed_at': now.isoformat()},
        {'id': 'spark3', 'state': 'unreachable', 'observed_at': now.isoformat()},
        {'id': 'spark4', 'state': 'online', 'observed_at': (now - timedelta(hours=2)).isoformat()},
    ]}
    (args.out / 'fleet-snapshot.json').write_text(json.dumps(snapshot))
    for stamp, kwh in [('2026-10-15T10:00:00-07:00', 1), ('2026-10-15T10:10:00-07:00', 1.02)]:
        record(args.out / 'energy.sqlite', spark='spark2', at=stamp, meter='fixture-meter', kwh=kwh)
    manager = get_plugin_manager()
    manager.discover_and_load()
    trace = []
    for name in ('spark_fleet_status', 'spark_electricity'):
        entry = registry.get_entry(name, scope=manager.scope_key)
        if entry is None:
            raise RuntimeError('Native Hermes did not discover the Sparks plugin.')
        original = entry.handler
        def traced(arguments, _name=name, _handler=original, **kwargs):
            result = _handler(arguments, **kwargs)
            trace.append({'tool': _name, 'arguments': arguments, 'result': json.loads(result)})
            return result
        entry.handler = traced

    cases = [
        ('fleet', 'Check the Spark fleet once. Which machines were observed running or off, which cannot be reached, and which observations are too old to confirm current state? Do not wake or change anything.', 'spark_fleet_status', {}),
        ('electricity', 'How much wall electricity was recorded across my Sparks for October 2026? Read that historical month. Give the total and say whether readings are incomplete or missing. Do not substitute the current month.', 'spark_electricity', {'month': '2026-10'}),
    ]
    report = {'host': socket.gethostname(), 'scope': 'New native read tools with explicit fixtures; no fleet changes.',
              'configured_runtime': args.configured_runtime, 'platform': args.platform,
              'enabled_toolsets': enabled, 'disabled_toolsets': disabled,
              'configuration_sha256': hashlib.sha256((home / 'config.yaml').read_bytes()).hexdigest(),
              'hermes': 'v0.23.2', 'selected_model': json.loads((root / 'models/main-model.json').read_text())['repository'],
              'eval_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              'source_hashes': {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
                                for folder in ('src', 'plugin') for p in (root / folder).rglob('*')
                                if p.is_file() and '__pycache__' not in str(p)}, 'cases': []}
    for case, prompt, expected_tool, expected_args in cases:
        trace.clear()
        agent = AIAgent(base_url=args.base_url, model='sparkie-hermes-main', api_key='local-placeholder',
                        provider='custom', api_mode='chat_completions', enabled_toolsets=enabled,
                        disabled_toolsets=disabled,
                        session_id=uuid.uuid4().hex, max_iterations=6, max_tokens=4096, quiet_mode=True,
                        reasoning_config={'enabled': True, 'effort': 'low'},
                        request_overrides={'temperature': 1.0, 'top_p': 0.95, 'extra_body': {
                            'top_k': 20, 'chat_template_kwargs': {'enable_thinking': True, 'thinking': True, 'reasoning_effort': 'low'}}},
                        skip_context_files=True, skip_memory=True, skip_background_review=True)
        started = time.monotonic()
        try:
            result = agent.run_conversation(prompt)
            receipt = {key: result.get(key) for key in ('completed', 'final_response', 'api_calls', 'messages', 'error')}
            receipt.update(seconds=round(time.monotonic() - started, 3), tools=list(trace), prompt=prompt)
            (args.out / (case + '.json')).write_text(json.dumps(receipt, indent=2, default=str))
            calls_ok = len(trace) == 1 and trace[0]['tool'] == expected_tool and trace[0]['arguments'] == expected_args
            report['cases'].append({'case': case, 'completed': result.get('completed'), 'seconds': receipt['seconds'],
                                    'exactly_one_correct_read': calls_ok, 'semantic_review_required': True})
        finally:
            agent.close()
        (args.out / 'summary.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    return 0 if all(case['completed'] and case['exactly_one_correct_read'] for case in report['cases']) else 1


if __name__ == '__main__':
    raise SystemExit(main())
