"""Extract and cross-check the owner-visible browser, native session, and tool receipts."""
from pathlib import Path
import json
import shutil
import sys

source, destination = map(Path, sys.argv[1:])
destination.mkdir(exist_ok=True, parents=True)
parse = lambda path: json.loads(path.read_text())
for name in ('desktop','phone'):
    pos = source / (name+'-final')
    browser = parse(pos / 'browser.json')
    durable = parse(pos / 'durable.json')
    provider = [json.loads(line) for line in (pos/'provider.jsonl').read_text().splitlines()]
    assert browser.get('error') is None and browser['interruptSent']
    assert browser['unauthenticatedStatus'] == 401 and not browser['unsignedSocket']['opened']
    assert browser['rpc'].count('prompt.submit') == browser['rpc'].count('session.interrupt') == 1
    assert [r['stage'] for r in provider] == [0,1,2]
    assert [r['marker_read'] for r in provider] == [False,True,True]
    assert durable['databases'] == ['state.db']
    assert [row['role'] for row in durable['messages']] == ['user','assistant','tool','assistant','tool','assistant']
    assert all(row['tool_name']=='terminal' for row in durable['messages'] if row['role']=='tool')
    assert json.loads(durable['messages'][2]['content']) == {'output':'RAW-EVIDENCE-KITE-5807\nbeta=7','exit_code':0,'error':None}
    assert durable['messages'][3]['content']=='The recorded checker result is seven for beta.'
    assert durable['messages'][5]['content'].startswith('Operation interrupted:')
    reads = [r for r in browser['http'] if r['path'].endswith('/messages')]
    assert reads and all(r['status']==200 and r['raw'] and r['interpretation'] for r in reads)
    parsed = {}
    for phase in ('liveDefault','liveExpanded','stopped','reloadDefault','reloadExpanded'):
        obs = browser['phases'][phase]
        assert obs['first'] and obs['owner'] and obs['interpretation']
        assert obs['raw'] == (phase in ('liveExpanded','reloadExpanded'))
        assert ('Response stopped' in ''.join(obs['assistantRows'])) == (phase in ('stopped','reloadDefault','reloadExpanded'))
        parsed[phase] = {k:v for k,v in obs.items() if k!='buttons'}
    output = {
        'viewport':browser['viewport'], 'unsigned_sessions_get':browser['unauthenticatedStatus'],
        'unsigned_websocket':browser['unsignedSocket'], 'owner_submit_rpc_count':1, 'owner_interrupt_rpc_count':1,
        'observed_browser_phases':parsed, 'authenticated_message_reads':reads,
        'live_disclosure_controls':browser['phases']['liveExpandedActions'],
        'reloaded_disclosure_controls':browser['phases']['reloadExpandedActions'],
        'native_receipt_rows':[{k:v for k,v in r.items() if k!='session_id'} for r in durable['messages']],
        'durable_source':'state.db', 'scripted_provider_rounds':provider,
        'sandbox_allocations':[json.loads(line) for line in (pos/'leases.jsonl').read_text().splitlines()]
    }
    with (destination/(name+'.json')).open('w') as o:
        json.dump(output,o,indent=2);o.write('\n')
    for phase in ('live','stopped','reload'):
        shutil.copyfile(pos/(phase+'.png'), destination/(name+'-'+phase+'.png'))
