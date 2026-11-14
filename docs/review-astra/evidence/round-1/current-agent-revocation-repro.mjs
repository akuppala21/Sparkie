import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const reviewRoot=resolve(process.env.SPARK_REVIEW_ROOT || fileURLToPath(new URL('../../../../',import.meta.url)));
// Current Sparkie review. Isolated stand-in fleet; no real SSH/Tailscale/Docker.
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
const {startMock} = await import(pathToFileURL(join(reviewRoot,'test/start-mock.mjs')).href);
const {request} = await import(pathToFileURL(join(reviewRoot,'test/lib.mjs')).href);
const fleet = await startMock({watchMs: 60000, statusMs: 60000, knowledge: true, timeoutMs: 90000});
const pause = ms => new Promise(r => setTimeout(r, ms));
const state = () => readFileSync(join(fleet.root,'spark4/.mock/containers'),'utf8').split('\n').find(l => l.startsWith('sc-RadixArk--Qwen3.8-27B-NVFP4|'))?.split('|')[1];
async function api(path, method='GET', body) {
  const r = await request(fleet.base + path, {method, headers: method==='GET'?{}:{'content-type':'application/json','x-spark-console':'1',origin:fleet.origin},body:body===undefined?undefined:JSON.stringify(body)});
  return {...r,json:JSON.parse(r.text)};
}
try {
  const before = state(); assert.equal(before,'running');
  const key = await api('/agents','POST',{name:'revocation-review-fixture'});assert.equal(key.status,201);
  assert.equal((await api('/agents/'+key.json.id,'PUT',{act:true})).status,200);
  const started = Date.now();
  const active = request(fleet.mcp,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+key.json.token},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'ask_sparkie',arguments:{message:'Stop sc-RadixArk--Qwen3.8-27B-NVFP4 on spark 4; take 12 seconds.'}}}),timeout:90000});
  const requests=join(fleet.dir,'model-requests.jsonl');
  while(!(existsSync(requests)&&readFileSync(requests,'utf8').includes('take 12 seconds'))) {if(Date.now()-started>30000)throw Error('Model was not called');await pause(50);}
  assert.equal(state(),'running');
  const revoked=await api('/agents/'+key.json.id,'DELETE');assert.equal(revoked.status,200);
  const revokedAt=Date.now();
  console.log('Agent removed while model reply pending; container still:',state());
  const response=await active;
  const rpc=JSON.parse(response.text),content=rpc.result?.content?.map(x=>x.text||'').join('');
  const value=content?JSON.parse(content):null;
  console.log('Old ask_sparkie response:',JSON.stringify(value));
  for(let i=0;i<400&&state()==='running';i++)await pause(100);
  const after=state();
  const auditFile=join(fleet.stateDir,'audit.jsonl');
  const audit=readFileSync(auditFile,'utf8').trim().split('\n').map(JSON.parse).filter(x=>['agent-removed','stop_model'].includes(x.action));
  console.log('Relevant audit:',JSON.stringify(audit));
  console.log('Seconds since revocation:',((Date.now()-revokedAt)/1000).toFixed(2));
  console.log('Container before/after:',before,after);
  assert.equal(after,'exited','Expected bug: the old turn still stops the model after its agent is removed');
  console.log('CONFIRMED: a future model-stop action ran after its agent key was deleted.');
} finally {await fleet.stop();}
