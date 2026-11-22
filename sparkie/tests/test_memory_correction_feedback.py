"""Exercise the native memory tool, registered feedback, and a fresh reader."""

import json
from pathlib import Path
import shutil
from types import SimpleNamespace

import pytest

from sparkie_sparks.memory_controls import correction_feedback


@pytest.mark.integration
@pytest.mark.parametrize('original_target', ['memory', 'user'])
def test_native_correction_in_original_target(tmp_path, monkeypatch, original_target):
    home = tmp_path / 'hermes'
    shutil.copytree(Path(__file__).resolve().parents[1] / 'plugin', home / 'plugins/sparkie-sparks')
    (home / 'config.yaml').write_text('plugins:\n  enabled: [sparkie-sparks]\n')
    monkeypatch.setenv('HERMES_HOME', str(home))
    from hermes_cli.plugins import discover_plugins
    from agent.agent_runtime_helpers import invoke_tool
    from tools.memory_tool import load_on_disk_store, memory_tool

    discover_plugins(force=True)
    agent = SimpleNamespace(session_id='save', _memory_store=load_on_disk_store(), _memory_manager=None)
    alternate = 'user' if original_target == 'memory' else 'memory'
    old, new = 'Prefers PNG chart exports.', 'Prefers SVG chart exports.'
    save = {'target': original_target, 'operations': [{'action': 'add', 'content': old}]}
    assert json.loads(invoke_tool(agent, 'memory', save, 'save'))['success'] is True

    agent.session_id, agent._memory_store = 'correct', load_on_disk_store()
    wrong = {'target': alternate, 'operations': [{'action': 'patch', 'old_text': old, 'content': new}]}
    native = json.loads(memory_tool(store=agent._memory_store, **wrong))
    result = json.loads(invoke_tool(agent, 'memory', wrong, 'correct'))
    hint = result.pop('correction_hint')
    assert f"target '{original_target}'" in hint and 'If' in hint and old not in hint
    assert native['success'] is False and result == native
    assert old in agent._memory_store.format_for_system_prompt(original_target)

    changed = json.loads(invoke_tool(agent, 'memory', {**wrong, 'target': original_target}, 'correct'))
    assert changed['success'] is True and 'correction_hint' not in changed
    fresh = load_on_disk_store()
    assert getattr(fresh, original_target + '_entries') == [new]
    assert getattr(fresh, alternate + '_entries') == []
    assert new in fresh.format_for_system_prompt(original_target)
    assert old not in fresh.format_for_system_prompt(original_target)


def test_feedback_leaves_unrelated_results_and_mutations_to_hermes():
    patch = {'action': 'patch', 'old_text': 'old', 'content': 'current'}
    failed = {'success': False, 'error': "No entry matched 'old'. Retry the patch with old_text copied verbatim from the intended entry."}
    args = {'target': 'user', **patch}
    for result in ({'success': True}, {'success': False, 'done': True, 'error': failed['error']},
                   {'success': False, 'error': "Multiple entries matched 'old'."},
                   {'success': False, 'error': 'Built-in USER.md writes are disabled in memory config.'},
                   {'success': False, 'status': 'pending'}, {'error': 'Owner confirmation required.'}):
        assert correction_feedback('memory', args, json.dumps(result)) is None
    for invalid in ({**args, 'action': 'remove'}, {**args, 'content': ' '},
                    {**args, 'operations': [patch, patch]}, {**args, 'target': 'other'}):
        assert correction_feedback('memory', invalid, json.dumps(failed)) is None
    assert correction_feedback('other', args, json.dumps(failed)) is None
    hinted = json.loads(correction_feedback('memory', args, json.dumps(failed)))
    assert 'MEMORY.md' in hinted.pop('correction_hint') and hinted == failed
