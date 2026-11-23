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
other=Path('/tmp/secondary-profile/attachments/private-scope-note.txt')
other.parent.mkdir(parents=True)
other.write_text('UNSHARED-SCOPE-3779')
class FixtureLease:
 def configuration(self):
  return {'nodes':[{'spark_id':'spark2','machine_id':'1'*32,'host':'127.0.0.1'}],
   'hub_machine_id':'0'*32,'image':os.environ['TEST_SANDBOX_IMAGE'],'release_queue':str(private/'release')}
 def acquire(self,request,generation):
  alias,kind,key=Path('/keys/known_hosts').read_text().split()
  record=WorkspaceLease(WorkspaceRequest(**request),alias.removeprefix('sparkie-workspace-'),'spark2','1'*32,'127.0.0.1',2222,'sandbox',os.environ['TEST_CONTAINER_ID'],os.environ['TEST_SANDBOX_IMAGE'],'/keys/client','/keys/known_hosts',alias,kind+' '+key,generation)
  with (r/'leases.jsonl').open('a') as fd:fd.write(json.dumps({'allocated':True,'user':'sandbox','backend':'spark_compute'})+'\n')
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
  target='What is the exhibit check?' in sent
  tool_result='\n'.join(str(m.get('content','')) for m in messages if m['role']=='tool')
  call=target and not tool_result
  out={'role':'assistant','content':'Reading the supplied file.' if call else ('UPLOAD CAPTURED' if target else 'fixture')}
  if target:
   match=re.search(r'@file:([^\s]+exhibit-check\.txt)',sent)
   raw=match[1] if match else ''
   hint=re.search(r'File tools use ("[^"\n]+")\.',sent)
   path=json.loads(hint[1]) if hint else raw
   exposed=[t.get('function',{}).get('name') for t in body.get('tools',[])]
   row=dict(inline='EVIDENCE-MALLOW-7249' in sent,raw_ref=raw,tool_path=path,explicit_tool_path=bool(hint),
      other_profile_withheld='UNSHARED-SCOPE-3779' not in sent,other_profile_warning='outside the allowed workspace' in sent,
      tool_result=tool_result,marker_in_tool_result='EVIDENCE-MALLOW-7249' in tool_result)
   with (r/'provider.jsonl').open('a') as fp:fp.write(json.dumps(row)+'\n')
   if call:
    calls=[{'name':'read_file','arguments':{'path':path}},{'name':'read_file','arguments':{'path':str(other)}}]
    if 'read_file' not in exposed and 'tool_call' in exposed:
     calls=[{'name':'tool_call','arguments':{'calls':calls}}]
    out['tool_calls']=[{'id':'call_native_upload_'+str(i),'type':'function','function':{'name':v['name'],'arguments':json.dumps(v['arguments'])}} for i,v in enumerate(calls)]
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
 for i in range(145):
  if (r/'finished').exists():break
  time.sleep(1)
finally:
 gw.terminate()
 try:gw.wait(12)
 except subprocess.TimeoutExpired:gw.kill()
 predicate=lambda s:('error' in s.lower() or 'failed' in s.lower()) and 'ticket' not in s.lower() and 'token' not in s.lower()
 (r/'server-info.txt').write_text('\n'.join(line[:400] for line in Path('/tmp/server.log').read_text().splitlines() if predicate(line))[-4000:])
 (r/'link').unlink(missing_ok=True)
 fleet.shutdown()
 fleet.server_close()
