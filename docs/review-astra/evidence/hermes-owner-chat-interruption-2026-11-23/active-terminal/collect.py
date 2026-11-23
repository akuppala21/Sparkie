"""Emit owner-neutral comparisons of physical execution and the actual owner view."""
import hashlib
import json
from pathlib import Path
import sys

expected = {
    'full-release-desktop': ('packaged-candidate','stop','desktop',None),
    'stop1': ('baseline', 'stop', 'desktop', 130),
    'interrupted-desktop': ('candidate', 'stop','desktop',None),
    'interrupted-phone': ('candidate','stop','phone',None),
    'completed-desktop': ('candidate','normal','desktop',0),
    'own130-desktop': ('candidate','normal','desktop',130),
    'nonzero-desktop': ('candidate','normal','desktop',7),
}
root = Path(sys.argv[1])
rows = []
for folder, (revision, action, viewport, status) in expected.items():
    run = root/folder
    get = lambda f: json.loads((run/f).read_bytes())
    physical = get('physical.json')
    browser = get('browser.json')
    messages = get('durable.json')['messages']
    command = 'python3 /workspace/stop_probe.py'
    assert any(command in str(m.get('tool_calls')) for m in messages)
    tool, = [json.loads(r['content']) for r in messages if r['role']=='tool']
    assert tool['exit_code'] == status
    assert browser['unauthenticatedStatus']==401 and not browser.get('error') and not (run/'link').exists()
    assert browser['rpc'].count('session.interrupt')==int(action=='stop')
    assert not physical[0]['marker'] and physical[0]['alive']
    assert physical[-1]['marker'] and not physical[-1]['alive']
    first_marker=next(v for v in physical if v['marker'])
    assert first_marker['age_s'] >= 12
    view = '\n'.join(browser['phases']['reloadExpanded']['assistantRows'])
    assert command in view and ('Response stopped' in view)==(action=='stop')
    assert status is None or f'exit {status}' in view
    lease = [json.loads(line) for line in (run/'leases.jsonl').read_text().splitlines()]
    assert lease and all(v['backend']=='spark_compute' and v['allocated'] for v in lease)
    data = {'revision':revision,'action':action,'viewport':viewport,'backend':'spark_compute',
            'authentication_guest_status':401,'native_stop_rpcs':browser['rpc'].count('session.interrupt'),
            'process_observed_alive_after_click':any(v['click_observed'] and v['alive'] for v in physical),
            'first_click_observed_seconds':next((v['age_s'] for v in physical if v['click_observed']),None),
            'last_process_alive_seconds':max(v['age_s'] for v in physical if v['alive']),
            'first_marker_seconds':first_marker['age_s'],'last_observation_seconds':physical[-1]['age_s'],
            'marker_written':True, 'durable_exit_code':tool['exit_code'],'durable_error':tool.get('error'),
            'durable_status':tool.get('status'),'visible_exit_badge':None if status is None else f'exit {status}',
            'response_stopped_visible':'Response stopped' in view,'real_model_calls':0}
    if revision!='baseline':
        assert all(v['via_ssh'] for v in physical)
        data['ssh_connection_present_in_command_environment']=True
    if action=='stop':
        assert data['process_observed_alive_after_click']
        assert not any('The synthetic command completed.' in str(r.get('content')) for r in messages if r['role']=='assistant')
        if revision!='baseline':
            assert tool['status']=='remote_outcome_unknown' and tool['error']==tool['user_summary']
            assert 'may still be running' in tool['error'] and 'verification_evidence' not in tool
            assert 'exit 130' not in view and tool['workspace_id'] in [r['workspace_id'] for r in lease]
            data['workspace_id_matches_allocator']=True
            data['warning_after_reload']='may still be running' in view
            assert data['warning_after_reload'], 'Remote uncertainty missing from reloaded owner UI'
        else:
            assert tool['output']=='[Command interrupted]'
            data['durable_output']=tool['output']
    else:
        assert tool['error'] is None and tool.get('status') is None
        assert 'remote_outcome_unknown' in tool['output']
        data['printed_json_kept_as_stdout']=True
        assert 'Synthetic command completed.' in tool.get('output','')
    if data.get('durable_error') and tool.get('workspace_id'):
        data['durable_error'] = data['durable_error'].replace(tool['workspace_id'], '[workspace ID]')
    collapsed = '\n'.join(browser['phases']['reloadDefault']['assistantRows'])
    data['warning_visible_in_collapsed_row'] = 'may still be running' in collapsed
    rows.append(data)
print(json.dumps(rows,indent=2))
