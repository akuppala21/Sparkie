import os, pathlib, shutil, sys, subprocess, time, threading, json, http.server
from pathlib import Path
from tempfile import TemporaryDirectory
r=Path('/results')
candidate=Path(os.environ['CANDIDATE'])
home=Path(os.environ['HERMES_HOME'])
home.mkdir(parents=True)
(home/'config.yaml').write_text('''model:
  default: mock-model
  provider: mock
providers:
  mock:
    api: http://127.0.0.1:8246/v1
    name: Mock
    api_mode: chat_completions
    key_env: MOCK_API_KEY
    models:
      mock-model: {}
    context_length: 64000
sessions:
  auto_prune: false
auxiliary:
  title_generation:
    enabled: false
plugins:
  enabled: [sparkie-sparks]
agent:
  defer_tools: all
webapp:
  enabled: true
  port: 9120
terminal:
  backend: spark_compute
''')
(home/'.env').write_text('MOCK_API_KEY=fixture\n')
from sparkie_sparks.broker import FleetServer
from sparkie_sparks.workspace_types import WorkspaceLease, WorkspaceRequest
from dataclasses import asdict
import re
private=Path('/tmp/test-owner-control')
private.mkdir(mode=0o700)
class FixtureLease:
 def configuration(self):
  return {'nodes':[{'spark_id':'spark2','machine_id':'1'*32,'host':'127.0.0.1'}],
   'hub_machine_id':'0'*32,'image':os.environ['TEST_SANDBOX_IMAGE'],'release_queue':str(private/'release')}
 def acquire(self,request,generation):
  alias,kind,key=Path('/keys/known_hosts').read_text().split()
  record=WorkspaceLease(WorkspaceRequest(**request),alias.removeprefix('sparkie-workspace-'),'spark2','1'*32,'127.0.0.1',2222,'sandbox',os.environ['TEST_CONTAINER_ID'],os.environ['TEST_SANDBOX_IMAGE'],'/keys/client','/keys/known_hosts',alias,kind+' '+key,generation)
  with (r/'leases.jsonl').open('a') as fd:fd.write(json.dumps({'allocated':True,'user':'sandbox','backend':'spark_compute','workspace_id':record.workspace_id})+'\n')
  return asdict(record)
 def idle(self,**kwargs):
  return {'state':'unknown','operation_id':'fixture-observe'}
 release=idle
sock=private/'control.sock'
fleet=FleetServer(sock,None,gateway_uid=os.getuid(),workspaces=FixtureLease())
threading.Thread(target=fleet.serve_forever,daemon=True).start()
os.environ['SPARKIE_CONTROL_SOCKET']=str(sock)
class Provider(http.server.BaseHTTPRequestHandler):
 def log_message(self,*a):pass
 def do_GET(self):
  self.send_response(200); self.send_header('Content-Type','application/json'); self.end_headers(); self.wfile.write(b'{"data":[{"id":"mock-model","object":"model"}]}')
 def do_POST(self):
  body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
  messages=body.get('messages',[]); user=next((m for m in reversed(messages) if m['role']=='user'),{})
  sent=str(user.get('content',''))
  target='disposable study' in sent
  results=[str(m.get('content','')) for m in messages if m['role']=='tool']
  exposed=[t.get('function',{}).get('name') for t in body.get('tools',[])]
  stage=len(results) if target else -1
  out={'role':'assistant','content':'Fixture setup'}
  call=target and stage==0
  if target:
   with (r/'provider.jsonl').open('a') as fp:
    fp.write(json.dumps({'stage':stage,'stream':body.get('stream') is True,'marker_read':any('RAW-EVIDENCE-KITE-5807' in t for t in results),'actual_tool_results':results})+'\n')
  if call:
   out['content']='I will run the synthetic foreground command.'
   command='python3 /workspace/stop_probe.py'
   name,args='terminal',{'command':command}
   if name not in exposed:
    assert 'tool_call' in exposed
    name,args='tool_call',{'calls':[{'name':'terminal','arguments':args}]}
   out['tool_calls']=[{'id':'call_interrupt_fixture_'+str(stage),'type':'function','function':{'name':name,'arguments':json.dumps(args)}}]
  if target and stage>=1:
   out['content']='The synthetic command completed.' if any('Synthetic command completed.' in t for t in results) else 'The recorded tool returned without the completion marker.'
  common={'id':'fixture-completion','created':1,'model':'mock-model'}
  finish='tool_calls' if call else 'stop'
  self.send_response(200)
  if body.get('stream'):
   self.send_header('Content-Type','text/event-stream'); self.end_headers()
   parts=[{'role':'assistant','content':out['content']}]
   if call:parts.append({'tool_calls':[dict(c,index=i) for i,c in enumerate(out['tool_calls'])]})
   for delta in parts+[{}]:
    chunk=dict(common,object='chat.completion.chunk',choices=[{'index':0,'delta':delta,'finish_reason':None if delta else finish}])
    self.wfile.write(('data: '+json.dumps(chunk)+'\n\n').encode())
   self.wfile.write(b'data: [DONE]\n\n')
  else:
   self.send_header('Content-Type','application/json'); self.end_headers()
   self.wfile.write(json.dumps(dict(common,object='chat.completion',choices=[{'index':0,'message':out,'finish_reason':finish}])).encode())
provider=http.server.ThreadingHTTPServer(('127.0.0.1',8246),Provider)
threading.Thread(target=provider.serve_forever,daemon=True).start()
# This gateway is an offline fixture; its Webapp issues a one-use loopback launch link.
py=candidate/'hermes/.venv/bin/python'
gw=subprocess.Popen([py,'-m','hermes_cli.main','gateway','run'],stdout=open('/tmp/server.log','w'),stderr=subprocess.STDOUT)
try:
 for i in range(50):
  import socket
  try:
   with socket.create_connection(('127.0.0.1',9120),timeout=1):break
  except OSError:time.sleep(1)
 else:raise RuntimeError('gateway health failed: '+Path('/tmp/server.log').read_text()[-4500:])
 link=subprocess.run([py,'-m','hermes_cli.main','webapp','--no-open','--skip-build'],capture_output=True,text=True,timeout=35)
 import re
 m=re.search(r'http://127\.0\.0\.1:9120/webapp/launch#\S+',link.stdout)
 if not m:raise RuntimeError('fixture launch failed '+link.stdout[:120]+link.stderr[-250:])
 (r/'link').write_text(m[0])
 for i in range(220):
  if (r/'finished').exists():break
  time.sleep(1)
finally:
 import sqlite3
 rows=[]
 dbs=[]
 for db in home.rglob('*.db'):
  try:
   conn=sqlite3.connect('file:'+str(db)+'?mode=ro',uri=True)
   try:
    names=[x[1] for x in conn.execute('pragma table_info(messages)')]
    if 'role' not in names or 'content' not in names:continue
    dbs.append(db.name)
    cols=[key for key in ('id','session_id','role','content','tool_name','tool_call_id','tool_calls') if key in names]
    for row in conn.execute('select '+','.join(cols)+' from messages order by id'):
     data=dict(zip(cols,row))
     if data.get('role') in ('assistant','tool','user'):
      rows.append(data)
   finally:conn.close()
  except sqlite3.Error:continue
 (r/'durable.json').write_text(json.dumps({'databases':dbs,'messages':rows},indent=2,default=str))
 gw.terminate()
 try:gw.wait(12)
 except subprocess.TimeoutExpired:gw.kill()
 predicate=lambda s:('error' in s.lower() or 'failed' in s.lower()) and 'ticket' not in s.lower() and 'token' not in s.lower()
 (r/'server-info.txt').write_text('\n'.join(line[:400] for line in Path('/tmp/server.log').read_text().splitlines() if predicate(line))[-4000:])
 (r/'link').unlink(missing_ok=True)
 fleet.shutdown()
 fleet.server_close()
