"""One selected-model edit/test/diff task using native tools in a compute sandbox.

The file is an isolated copy of a real extension module with one deliberate bug.
Nothing is promoted, and the model has no access to installed code or credentials.
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
    args = parser.parse_args()
    args.out = args.out.resolve()
    if socket.gethostname() != 'compute2-host.invalid':
        parser.error('This fixture is reserved for compute Spark 2')
    root = Path(__file__).resolve().parents[2]
    args.out.mkdir(parents=True, exist_ok=False)
    home = args.out / 'hermes-home'
    shutil.copytree(root / 'plugin', home / 'plugins/sparkie-sparks')
    shutil.copyfile(root / 'SOUL.md', home / 'SOUL.md')
    shutil.copytree(root / 'skills/local-recipe-review', home / 'skills/local-recipe-review')
    from ruamel.yaml import YAML
    yaml = YAML()
    config = yaml.load(root / 'config/hermes.example.yaml')
    # The test process already lives on compute Spark 2. Reuse the proven native
    # Docker environment directly; this case does not requalify fleet allocation.
    config['terminal']['backend'] = 'docker'
    config['terminal']['cwd'] = '/workspace'
    with (home / 'config.yaml').open('w') as stream:
        yaml.dump(config, stream)
    for key in list(os.environ):
        if key.endswith(('_API_KEY', '_TOKEN', '_PASSWORD', '_SECRET')):
            os.environ.pop(key)
    os.environ.pop('SPARKIE_CONTROL_SOCKET', None)
    os.environ.update(HERMES_HOME=str(home), HERMES_DISABLE_LAZY_INSTALLS='1', HF_HUB_OFFLINE='1', NO_PROXY='*')
    from run_agent import AIAgent
    from hermes_cli.config import apply_terminal_config_to_env
    from hermes_cli.plugins import get_plugin_manager
    from tools.registry import discover_builtin_tools, registry
    from toolsets import create_custom_toolset
    from tools import terminal_tool as terminal
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from sandbox_cleanup import NativeSandboxCleanup
    from tools.file_tools import write_file_tool, read_file_tool
    from tools.environments.docker import DockerEnvironment
    from gateway.session_context import set_session_vars, clear_session_vars
    from native_profile import configured_agent_kwargs, trace_generation_fields
    apply_terminal_config_to_env(config=config, override=True)
    get_plugin_manager().discover_and_load()
    discover_builtin_tools()
    selected = json.loads((root / 'models/main-model.json').read_text())
    kwargs = configured_agent_kwargs(config, base_url='http://127.0.0.1:32202/v1', model=selected['served_model_name'])
    names = ['terminal', 'read_file', 'write_file', 'patch']
    assert all(registry.get_entry(name) is not None for name in names)
    create_custom_toolset('sparkie-self-work', 'Native file and terminal tools in the isolated compute workspace', tools=names)
    session = uuid.uuid4().hex
    tokens = set_session_vars(session_key=session, platform='cli')
    agent = AIAgent(**kwargs, model=selected['served_model_name'], session_id=session,
                    enabled_toolsets=['sparkie-self-work', 'no_mcp'], disabled_toolsets=config['agent']['disabled_toolsets'],
                    max_iterations=12, max_tokens=4096, run_budget_seconds=360, quiet_mode=True,
                    cwd='/workspace', skip_context_files=False, skip_memory=True, skip_background_review=True)
    original = (root / 'src/sparkie_sparks/fleet.py').read_text()
    broken = original.replace('type(value) in (int, float)', 'isinstance(value, (int, float))', 1)
    assert broken != original
    test = '''import unittest
from fleet import _details

class Metrics(unittest.TestCase):
    def test_booleans_are_not_measurements(self):
        result = _details({'metrics': {'gpu_utilization_percent': True, 'gpu_power_watts': False}})
        self.assertEqual(result['metrics'], {})
    def test_numbers_and_boundaries(self):
        result = _details({'metrics': {'gpu_utilization_percent': 0, 'gpu_power_watts': 25.5,
                                     'gpu_temperature_c': float('nan'), 'memory_total_bytes': -1}})
        self.assertEqual(result['metrics'], {'gpu_utilization_percent': 0, 'gpu_power_watts': 25.5})

if __name__ == '__main__':
    unittest.main()
'''
    report = {'host': socket.gethostname(), 'started_at': datetime.now(timezone.utc).isoformat(),
              'scope': 'Actual selected-model native file/terminal tools in real Docker on compute Spark 2; isolated extension copy; no live update or production allocation proof.',
              'eval_max_tokens': 4096, 'eval_max_iterations': 12,
              'source_sha256': hashlib.sha256(original.encode()).hexdigest(),
              'injected_sha256': hashlib.sha256(broken.encode()).hexdigest(),
              'test_sha256': hashlib.sha256(test.encode()).hexdigest(),
              'config_sha256': hashlib.sha256((home / 'config.yaml').read_bytes()).hexdigest(),
              'cleanup_sha256': hashlib.sha256((root / 'tests/sandbox_cleanup.py').read_bytes()).hexdigest(),
              'eval_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    def command(text):
        value = json.loads(terminal.terminal_tool(text, task_id=session, timeout=60))
        return value
    cleanup = NativeSandboxCleanup(home)
    wire, detach = trace_generation_fields(agent)
    started = time.monotonic()
    try:
        for path, content in [('/workspace/fleet.py', broken), ('/workspace/test_metrics.py', test)]:
            result = json.loads(write_file_tool(path, content, task_id=session))
            assert not result.get('error'), result
        # Native Docker's workspace ownership differs from its interactive user.
        # Trust only this synthetic path inside the disposable container; never
        # change host Git configuration or disable safe.directory globally.
        setup = command('cd /workspace && git config --global --add safe.directory /workspace && git init -q && git add fleet.py test_metrics.py && git -c user.name=Fixture -c user.email=fixture@example.invalid commit -qm baseline')
        assert setup['exit_code'] == 0, setup
        before = command('cd /workspace && python3 test_metrics.py')
        assert before['exit_code'] != 0 and 'FAIL' in before['output'], before
        (args.out / 'baseline-test.json').write_text(json.dumps(before, indent=2) + '\n')
        with terminal._env_lock:
            envs = [env for env in terminal._active_environments.values() if isinstance(env, DockerEnvironment)]
        assert len(envs) == 1
        cleanup.capture()
        if args.prepare_only:
            report.update(prepared=True, inference_called=False, passed=True)
        else:
            prompt = ('In /workspace there is an isolated copy of Sparkie extension fleet.py and test_metrics.py. '
                      'Boolean GPU metrics are incorrectly accepted as numeric measurements. Fix only fleet.py, '
                      'preserving valid numeric measurements and existing checks. Do not edit test_metrics.py. '
                      'Run python3 test_metrics.py and show git diff. Report the result and leave the change for review; '
                      'do not install anything or use network access.')
            result = agent.run_conversation(prompt)
            receipt = {key: result.get(key) for key in ('completed', 'final_response', 'api_calls', 'messages', 'error')}
            receipt.update(prompt=prompt, seconds=round(time.monotonic() - started, 3), wire_generation_fields=wire)
            (args.out / 'conversation.json').write_text(json.dumps(receipt, indent=2, default=str) + '\n')
            after = command('cd /workspace && python3 test_metrics.py')
            diff = command('cd /workspace && git diff -- fleet.py && git diff --exit-code -- test_metrics.py && git status --short')
            retrieved = json.loads(read_file_tool('/workspace/fleet.py', task_id=session))
            tests_unchanged = command('cd /workspace && git diff --exit-code -- test_metrics.py')['exit_code'] == 0
            report['checks'] = {'completed': result.get('completed') is True, 'baseline_failed': before['exit_code'] != 0,
                                'focused_tests_pass': after['exit_code'] == 0, 'tests_unchanged': tests_unchanged,
                                'diff_available': diff['exit_code'] == 0 and 'diff --git a/fleet.py b/fleet.py' in diff['output'],
                                'actual_generation_profile_captured': bool(wire)}
            report['model_reply'] = result.get('final_response')
            report['api_calls'] = result.get('api_calls')
            report['tool_calls'] = [row.get('name') for row in result.get('messages', []) if row.get('role') == 'tool']
            for name, value in [('after-test', after), ('diff', diff), ('edited-file', retrieved)]:
                (args.out / (name + '.json')).write_text(json.dumps(value, indent=2) + '\n')
            report['passed'] = all(report['checks'].values())
    except Exception as exc:
        report.update(passed=False, error=str(exc))
    finally:
        report['sandbox_cleanup'] = cleanup.finish()
        report['container_removed'] = report['sandbox_cleanup']['verified']
        report['passed'] = bool(report.get('passed') and report['container_removed'])
        detach()
        agent.close()
        clear_session_vars(tokens)
        report['seconds'] = round(time.monotonic() - started, 3)
        report['finished_at'] = datetime.now(timezone.utc).isoformat()
        (args.out / 'summary.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps(report))
    return 0 if report.get('passed') and report.get('container_removed') else 1


if __name__ == '__main__':
    raise SystemExit(main())
