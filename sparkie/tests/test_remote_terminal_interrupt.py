"""The checked remote completion status must survive owner display and resume."""
from types import SimpleNamespace
import json
import pytest

from agent.replay_cleanup import is_interrupted_tool_result, strip_interrupted_tool_tails
from tools import terminal_tool_result


def finish(raw, backend='spark_compute'):
    return terminal_tool_result.finalize_foreground_result(
        command='python3 probe.py', result=raw, env=SimpleNamespace(lease=SimpleNamespace(workspace_id='a' * 32)),
        env_type=backend, effective_task_id='sample', task_id='sample', session_id='chat',
        session_key='chat', workdir='/workspace', command_cwd='/workspace', approval_note=None,
    )


def test_remote_interruption_keeps_partial_output_and_resumes_as_unknown(monkeypatch):
    def no_receipt(*args):
        pytest.fail('Unobserved remote completion cannot support verification.')
    monkeypatch.setattr(terminal_tool_result, '_verification_evidence', no_receipt)
    payload = finish({'output': 'partial stdout\n[Command interrupted]', 'returncode': 130, 'hermes_interrupted': True})
    row = json.loads(payload)
    assert row['output'] == 'partial stdout' and row['exit_code'] is None
    assert row['status'] == 'remote_outcome_unknown' and row['workspace_id'] == 'a' * 32
    assert 'may still be running' in row['error'] and is_interrupted_tool_result(payload, tool_name="terminal")
    assert 'verification_evidence' not in row and 'exit_code_meaning' not in row
    call = {'role':'assistant', 'tool_calls':[{'id':'command', 'function':{'name':'terminal','arguments':'{}'}}]}
    history = strip_interrupted_tool_tails([call, {'role':'tool', 'tool_call_id':'command', 'content':payload}])
    assert history[0] == call and history[1]['effect_disposition'] == 'unknown'
    assert row['workspace_id'] in history[1]['content'] and 'Inspect state before retrying' in history[1]['content']
    other_call = {'role':'assistant', 'tool_calls':[{'id':'file', 'function':{'name':'read_file','arguments':'{}'}}]}
    other_history = [other_call, {'role':'tool','tool_call_id':'file','content':payload}]
    assert strip_interrupted_tool_tails(other_history) == other_history
    monkeypatch.setattr(terminal_tool_result, '_verification_evidence', lambda *args: None)
    echoed = finish({'output':payload,'returncode':0})
    assert json.loads(echoed)['exit_code'] == 0
    assert not is_interrupted_tool_result(echoed, tool_name="terminal")


@pytest.mark.parametrize('code', [0, 7, 130])
def test_completed_remote_command_keeps_its_real_exit(code, monkeypatch):
    monkeypatch.setattr(terminal_tool_result, '_verification_evidence', lambda *args: None)
    row = json.loads(finish({'output': 'Script output', 'returncode': code}))
    assert row['exit_code'] == code and row['error'] is None and 'status' not in row


def test_local_interruption_and_normal_text_stay_distinct(monkeypatch):
    monkeypatch.setattr(terminal_tool_result, '_verification_evidence', lambda *args: None)
    local = finish({'output': '[Command interrupted]', 'returncode': 130, 'hermes_interrupted': True}, 'local')
    assert json.loads(local)['exit_code'] == 130 and is_interrupted_tool_result(local)
    assert not is_interrupted_tool_result(json.dumps({'exit_code': None, 'output':'remote_outcome_unknown'}))
