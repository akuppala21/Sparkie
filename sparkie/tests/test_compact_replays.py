from behavior.native_acceptance import chat_replay_cases, has_successful_memory_write, only_called_file_reader, read_once


def test_compact_runner_requires_enrollment_before_writing_results(tmp_path, monkeypatch):
    import sys
    from pathlib import Path

    import pytest
    from behavior import native_acceptance

    identity = Path('/etc/machine-id')
    original = Path.read_text
    monkeypatch.setattr(Path, 'read_text', lambda path, *args, **kwargs:
                        'unenrolled-test-worker' if path == identity else original(path, *args, **kwargs))
    for options in ([], ['--structured-only'], ['--missing-reader-only'], ['--case', 'simple_question'],
                    ['--custody-record'], ['--custody-record', '--missing-reader-only']):
        output = tmp_path / 'results'
        monkeypatch.setattr(sys, 'argv', ['native_acceptance.py', '--out', str(output), *options])
        with pytest.raises(RuntimeError, match='allocated compute Spark'):
            native_acceptance.main()
        assert not output.exists()


def test_memory_replay_runs_prerequisites_once_in_order():
    assert chat_replay_cases(['unknown_preference', 'fresh_session_recall', 'correct_preference']) == [
        'save_preference', 'correct_preference', 'fresh_session_recall', 'unknown_preference']
    assert chat_replay_cases(['correct_preference']) == ['save_preference', 'correct_preference']
    assert chat_replay_cases(['failed_stop', 'failed_stop']) == ['failed_stop']


def test_failed_wrong_and_partial_file_reads_cannot_qualify_a_response():
    path = '/workspace/failed_stop.json'
    observed = {'not_found': False, 'truncated': False, 'content': '1|workload running'}
    def receipt(file, result):
        return {'reads': [{'arguments': {'path': file}, 'result': result}]}
    assert read_once(receipt(path, observed), path)
    assert not read_once(receipt('/workspace/other.json', observed), path)
    assert not read_once(receipt(path, {'not_found': True, 'error': 'missing'}), path)
    assert not read_once(receipt(path, dict(observed, truncated=True)), path)
    assert not read_once(receipt(path, dict(observed, truncated_lines=True)), path)
    suffix = receipt(path, observed)
    suffix['reads'][0]['arguments']['offset'] = 2
    assert not read_once(suffix, path)


def test_memory_success_requires_a_native_result_and_an_observed_write():
    saved = {'memory_before': {}, 'memory_after': {'USER.md': 'new'},
             'messages': [{'role': 'tool', 'name': 'memory', 'content': '{"success":true}'}]}
    assert has_successful_memory_write(saved)
    assert not has_successful_memory_write(dict(saved, memory_after={}))
    for name, body in [('terminal', '{"success": true}'), ('memory', 'example: "success": true'),
                       ('memory', '{"success":false,"example":{"success":true}}')]:
        assert not has_successful_memory_write(dict(saved, messages=[{'role': 'tool', 'name': name, 'content': body}]))


def test_decisive_file_rejects_unrelated_calls_even_when_the_answer_is_correct():
    read = {'function': {'name': 'read_file'}}
    view = {'function': {'name': 'skill_view'}}
    requested = {'role': 'assistant', 'tool_calls': [read]}
    observed = {'role': 'tool', 'name': 'read_file'}
    final = {'role': 'assistant', 'content': 'The workload was still running.'}
    assert only_called_file_reader([requested, observed, final])
    assert not only_called_file_reader([requested, final])
    assert not only_called_file_reader([observed, final])
    assert not only_called_file_reader([dict(requested, tool_calls=[read, view]), observed, final])
    assert not only_called_file_reader([requested, observed, {'role': 'assistant', 'function_call': {'name': 'skill_view'}}, final])
    assert not only_called_file_reader([requested, observed, {'role': 'tool', 'name': 'skill_view'}, final])


def test_read_tool_selection_requires_the_seeded_observations():
    from behavior.read_tools import has_fixture_evidence

    expected = {'spark1': ('online', False), 'spark4': ('online', True)}
    rows = [{'id': spark, 'observed_state': state, 'stale': stale}
            for spark, (state, stale) in expected.items()]
    assert has_fixture_evidence('fleet', {'available': True, 'sparks': rows}, expected)
    assert not has_fixture_evidence('fleet', {'available': True, 'sparks': []}, expected)
    assert not has_fixture_evidence('fleet', {'available': True, 'sparks': [rows[0], rows[0]]}, expected)
    month = {'available': True, 'month': '2026-10', 'recorded_kwh': 0.02, 'partial': True}
    assert has_fixture_evidence('electricity', month, expected)
    assert not has_fixture_evidence('electricity', dict(month, available=False), expected)
    assert not has_fixture_evidence('electricity', dict(month, recorded_kwh=None), expected)


def test_recovery_grader_binds_plain_presentation_to_the_exact_read():
    from behavior.proposal_acceptance import exact_plain_receipt_read

    operation = 'a' * 32
    def read(tool, **options):
        return exact_plain_receipt_read({'tool': tool, 'arguments': {'operation': operation, **options}}, operation)

    assert read('spark_change_status') and read('spark_check_change')
    assert read('spark_check_change', final_reply=True)
    assert read('spark_check_change', final_reply=False)
    assert not read('spark_check_change', operation='b' * 32)
    assert not read('spark_check_change', final_reply=1)
    assert not read('spark_check_change', reply_format='stop_receipt_json')
    assert not read('spark_check_change', approve=True)
    assert not read('spark_change_status', final_reply=True)
    assert not read('spark_propose_change')
