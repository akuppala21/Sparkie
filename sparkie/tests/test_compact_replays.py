from behavior.native_acceptance import chat_replay_cases, has_successful_memory_write, read_once


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
