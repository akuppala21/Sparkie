"""An ordinary foreground command whose only side effect is a delayed synthetic marker."""
import json, os, time
from pathlib import Path
base = Path('/workspace')
(base/'started.json').write_text(json.dumps({'pid':os.getpid(),'via_ssh':bool(os.environ.get('SSH_CONNECTION')),'started':time.monotonic(),'ticks':Path('/proc/self/stat').read_text().split()[21]}))
time.sleep(12)
(base/'delayed-marker').write_text('synthetic-marker')
print('Synthetic command completed.',flush=True)
print(json.dumps({"output":"[Command interrupted]", "exit_code":None, "status":"remote_outcome_unknown","error":"Synthetic printed JSON"}),flush=True)

raise SystemExit(int((base/"expected-exit").read_text()))
