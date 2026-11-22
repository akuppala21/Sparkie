"""One native electricity-period tool case against selected local inference.

Historical usage is priced at the explicitly requested estimate rate. Only
synthetic readings and a fresh Hermes home are used; no rate is saved.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import sys
import time
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--prepare-only', action='store_true')
    parser.add_argument('--managed-config', action='store_true', help='Use the native managed overlay and editable appearance fixture.')
    args = parser.parse_args()
    if socket.gethostname() != 'compute2-host.invalid':
        parser.error('Run this bounded case only on compute Spark 2')
    args.out = args.out.resolve()
    args.out.mkdir(parents=True, exist_ok=False)
    root = Path(__file__).resolve().parents[2]
    home = args.out / 'hermes-home'
    shutil.copytree(root / 'plugin', home / 'plugins/sparkie-sparks')
    shutil.copyfile(root / 'config/hermes.example.yaml', home / 'config.yaml')
    shutil.copyfile(root / 'SOUL.md', home / 'SOUL.md')
    shutil.copytree(root / 'skills/local-recipe-review', home / 'skills/local-recipe-review')
    for key in list(os.environ):
        if key.endswith(('_API_KEY', '_TOKEN', '_PASSWORD', '_SECRET')):
            os.environ.pop(key)
    os.environ.pop('SPARKIE_CONTROL_SOCKET', None)
    os.environ.update(HERMES_HOME=str(home), HERMES_DISABLE_LAZY_INSTALLS='1', HF_HUB_OFFLINE='1', NO_PROXY='*',
                      SPARKIE_ENERGY_DATABASE=str(args.out / 'energy.sqlite'))
    policy = None
    if args.managed_config:
        from ruamel.yaml import YAML
        sys.path.insert(0, str(root / 'deploy'))
        from managed_config import split
        policy, preferences = split(YAML(typ='safe').load(home / 'config.yaml'))
        preferences['dashboard'] = {'theme': 'midnight'}
        (home / 'managed').mkdir()
        for path, value in ((home / 'managed/config.yaml', policy), (home / 'config.yaml', preferences)):
            with path.open('w') as stream: YAML().dump(value, stream)
        os.environ.update(HERMES_MANAGED_DIR=str(home / 'managed'), HERMES_CONFIG_BACKEND='file')
    def audit(event, values):
        if event == 'socket.connect':
            address = values[1]
            if not isinstance(address, tuple) or address[:2] != ('127.0.0.1', 32202):
                raise PermissionError('Only the isolated local inference endpoint is available')
    sys.addaudithook(audit)
    from sparkie_sparks.energy import record
    from hermes_cli.plugins import get_plugin_manager
    from hermes_cli.config import load_config_readonly
    from tools.registry import discover_builtin_tools, registry
    from toolsets import create_custom_toolset
    from native_profile import configured_agent_kwargs, trace_generation_fields
    from run_agent import AIAgent
    for stamp, value in [('2025-10-15T10:00:00-07:00', 1), ('2025-10-15T10:10:00-07:00', 1.02)]:
        record(args.out / 'energy.sqlite', spark='spark2', at=stamp, meter='fixture-meter', kwh=value)
    manager = get_plugin_manager()
    manager.discover_and_load()
    discover_builtin_tools()
    create_custom_toolset('sparkie-electricity-period-eval', 'One actual read-only electricity tool', tools=['spark_electricity'])
    entry = registry.get_entry('spark_electricity', scope=manager.scope_key)
    assert entry is not None
    config = load_config_readonly()
    def includes(actual, expected):
        return (isinstance(actual, dict) and all(key in actual and includes(actual[key], value)
                for key, value in expected.items())) if isinstance(expected, dict) else actual == expected
    if policy is not None:
        assert includes(config, policy) and config['dashboard']['theme'] == 'midnight'
    selected = json.loads((root / 'models/main-model.json').read_text())
    kwargs = configured_agent_kwargs(config, base_url='http://127.0.0.1:32202/v1', model=selected['served_model_name'])
    expected = {'period': 'year', 'selected': '2025', 'rate': 0.4}
    sample = json.loads(entry.handler(expected))
    assert sample['recorded_kwh'] == 0.02 and sample['cost_usd'] == 0.008
    assert sample['rate_usd_per_kwh'] == 0.4 and sample['partial'] is True
    assert json.loads(entry.handler({'period': 'year', 'selected': '2025'}))['cost_usd'] is None
    (args.out / 'schema.json').write_text(json.dumps(entry.schema, indent=2) + '\n')
    if args.prepare_only:
        print(json.dumps({'prepared': True, 'inference_called': False, 'fixture': sample}))
        return 0
    trace = []
    original = entry.handler
    def traced(arguments, **extra):
        result = original(arguments, **extra)
        trace.append({'arguments': arguments, 'result': json.loads(result)})
        return result
    entry.handler = traced
    timing, start = {}, None
    def mark(key, value):
        if start is not None and value and key not in timing:
            timing[key] = round(time.monotonic() - start, 3)
    agent = AIAgent(**kwargs, model=selected['served_model_name'], session_id=uuid.uuid4().hex,
        enabled_toolsets=['sparkie-electricity-period-eval', 'no_mcp'], disabled_toolsets=config['agent']['disabled_toolsets'],
        max_iterations=4, max_tokens=4096, run_budget_seconds=180, quiet_mode=True, cwd=str(args.out),
        skip_context_files=False, skip_memory=True, skip_background_review=True,
        stream_delta_callback=lambda text: mark('first_visible_text_seconds', text.strip() if text else None),
        tool_gen_callback=lambda tool: mark('first_tool_event_seconds', tool))
    wire, detach = trace_generation_fields(agent)
    prompt = 'How much electricity was recorded across my Sparks for 2025, and what would that recorded usage cost at $0.40 per kWh? Read that year once and keep the answer brief. Tell me whether the recorded figures cover the whole year.'
    started_at = datetime.now(timezone.utc).isoformat()
    start = time.monotonic()
    try:
        result = agent.run_conversation(prompt)
        receipt = {key: result.get(key) for key in ('completed', 'final_response', 'api_calls', 'messages', 'error')}
        receipt.update(prompt=prompt, calls=trace, wire_generation_fields=wire, seconds=round(time.monotonic()-start, 3), timing=timing,
                       started_at=started_at, host=socket.gethostname(),
                       eval_max_tokens=4096, eval_max_iterations=4, semantic_review_required=True,
                       scope='One actual native electricity tool, selected local model/profile, synthetic historical usage and explicitly requested estimate rate; no rate writes or live state.')
        receipt['managed_config'] = {'enabled': policy is not None,
            'effective_config_sha256': hashlib.sha256(json.dumps(config, sort_keys=True, default=str).encode()).hexdigest(),
            'user_config_sha256': hashlib.sha256((home / 'config.yaml').read_bytes()).hexdigest(),
            'policy_sha256': hashlib.sha256((home / 'managed/config.yaml').read_bytes()).hexdigest() if policy is not None else None}
        receipt['checks'] = {'completed': result.get('completed') is True,
            'one_exact_year_read': len(trace) == 1 and trace[0]['arguments'] == expected,
            'actual_generation_profile_captured': bool(wire),
            'historical_cost_uses_requested_rate': len(trace) == 1 and trace[0]['result']['cost_usd'] == 0.008
                and trace[0]['result']['rate_usd_per_kwh'] == 0.4,
            'rate_not_persisted': json.loads(original({'period': 'year', 'selected': '2025'}))['cost_usd'] is None}
        if policy is not None:
            receipt['checks']['native_managed_policy_preserved'] = includes(load_config_readonly(), policy)
            receipt['checks']['native_theme_preserved'] = load_config_readonly()['dashboard']['theme'] == 'midnight'
        receipt['inputs'] = {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in [
            Path(__file__), Path(__file__).with_name('native_profile.py'), root / 'plugin/__init__.py',
            root / 'src/sparkie_sparks/energy.py', root / 'config/hermes.example.yaml', root / 'SOUL.md', root / 'models/main-model.json']}
        if policy is not None:
            receipt['inputs']['deploy/managed_config.py'] = hashlib.sha256((root / 'deploy/managed_config.py').read_bytes()).hexdigest()
        (args.out / 'result.json').write_text(json.dumps(receipt, indent=2, default=str) + '\n')
        print(json.dumps({key: receipt[key] for key in ('checks', 'seconds', 'timing', 'final_response')}), flush=True)
        return 0 if all(receipt['checks'].values()) else 1
    finally:
        detach()
        entry.handler = original
        agent.close()


if __name__ == '__main__':
    raise SystemExit(main())
