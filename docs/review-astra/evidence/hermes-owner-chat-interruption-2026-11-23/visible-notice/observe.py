import json,subprocess,sys,time
from pathlib import Path
box,output=sys.argv[1:]; base=Path(output)
deadline=time.monotonic()+70
rows=[]
while time.monotonic()<deadline:
    code="""import json,time
from pathlib import Path
p=Path('/workspace/started.json')
if p.exists():
 a=json.loads(p.read_bytes());q=Path('/proc')/str(a['pid'])/'stat';f=q.read_text().split() if q.exists() else [];print(json.dumps({'via_ssh':a.get('via_ssh'),'age_s':round(time.monotonic()-a['started'],2),'alive':bool(f and f[21]==a['ticks'] and f[2]!='Z'),'marker':Path('/workspace/delayed-marker').exists()}))
"""
    obs=subprocess.run(['docker','exec',box,'python3','-c',code],capture_output=True,text=True)
    if obs.stdout.strip():
        row=json.loads(obs.stdout);row['click_observed']=(base/'cancel-sent').exists()
        rows.append(row)
        (base/'command-started').touch()
        (base/'physical.json').write_text(json.dumps(rows))
        if row['age_s']>14:
            (base/'physical-done').touch()
            break
    time.sleep(.25)
