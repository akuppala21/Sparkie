"""Validate the native default transcript, independent process observer and wire counts."""
import json
from pathlib import Path
import sys

root=Path(sys.argv[1])
runs = [('stop-desktop', True, 'desktop', None), ('stop-phone', True, 'phone', None),
        ('zero-desktop', False, 'desktop', 0), ('own130-desktop', False, 'desktop', 130)]
if (root/'packaged-desktop').exists():
    runs.append(('packaged-desktop', True,'desktop',None))
warning='The remote command may still be running. Check its workspace before repeating it.'
def load(p):return json.loads(p.read_bytes())
cases=[]
for name,stopped,viewport,code in runs:
    out=root/name
    b=load(out/'browser.json'); d=load(out/'durable.json')['messages']; observations=load(out/'physical.json')
    rows=b['phases']
    assert not b.get('error') and b['unauthenticatedStatus']==401
    assert not (out/'link').exists() and b['rpc'].count('session.interrupt') == int(stopped)
    assert observations[-1]['marker'] and not observations[-1]['alive']
    assert all(row['via_ssh'] for row in observations) and any(row['alive'] for row in observations)
    tool,=[json.loads(m['content']) for m in d if m['role']=='tool']
    assert tool['exit_code']==code
    phases={key:warning in ' '.join(row['assistantRows']) for key,row in rows.items() if 'assistantRows' in row}
    stages=[json.loads(line)['stage'] for line in (out/'provider.jsonl').read_text().splitlines()]
    assert stages == ([0] if stopped else [0,1]),stages
    assert not phases['active']
    assert phases['after']==stopped and phases['reloadDefault']==stopped
    assert any(warning in str(m['content']) for m in d if m['role']=='assistant')==stopped
    if stopped:
        display_row, = [m for m in d if m['role']=='assistant' and warning in str(m['content'])]
        assert display_row['api_content'] == '[interrupt: no assistant output for this turn]'
        assert json.loads(display_row['display_metadata'])['interrupted'] is True
        assert 0 < b['noticeAfterClickMs'] < 6000 and phases['clickDefault']
        assert rows['clickDefault']['warningBox']['visible'] and rows['reloadDefault']['warningBox']['visible']
        assert tool['status']=='remote_outcome_unknown' and any(row['click_observed'] and row['alive'] for row in observations)
    else:
        assert 'remote_outcome_unknown' in tool['output'] and not tool.get('status')
        assert 'exit '+str(code) in ' '.join(rows['reloadExpanded']['assistantRows'])
    cases.append({'case':name,'viewport':viewport,'stopped':stopped,'native_stop_rpcs':int(stopped),
                  'notice_first_visible_after_click_ms':b.get('noticeAfterClickMs'),'notice_visible_by_phase':phases,
                  'durable_tool_exit':code,'notice_persisted_as_display_text':stopped, 'reloaded_notice_viewport_box':rows['reloadDefault']['warningBox'],
                  'marker_written':True,'first_marker_seconds':next(row['age_s'] for row in observations if row['marker']),
                  'synthetic_completion_requests':len(stages),'inference_requests':0})
print(json.dumps(cases,indent=2))
