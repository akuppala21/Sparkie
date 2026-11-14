import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const reviewRoot=resolve(process.env.SPARK_REVIEW_ROOT || fileURLToPath(new URL('../../../../',import.meta.url)));
// Peer review: a truncated non-200 model reply, followed by the owner's /stop.
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const {startMock} = await import(pathToFileURL(join(reviewRoot,'test/start-mock.mjs')).href);
const {T,api,newChat} = await import(pathToFileURL(join(reviewRoot,'test/lib.mjs')).href);
let received;const got=new Promise(r=>received=r);
const model=http.createServer((req,res)=>{req.resume();req.on('end',()=>{received();res.writeHead(503,{'content-length':'10000','content-type':'application/json'});res.write('{"error":"shutting down');setTimeout(()=>res.destroy(),50);});});
await new Promise(r=>model.listen(0,'127.0.0.1',r));
let fleet;const controller=new AbortController();let pending;
try {
  fleet=await startMock({watchMs:600000,statusMs:600000,prepare:({stateDir})=>{
    const p=join(stateDir,'main.json'),j=JSON.parse(readFileSync(p,'utf8'));
    j.chat={kind:'endpoint',url:`http://127.0.0.1:${model.address().port}`,model:'review-fixture',title:'Review fixture',node:'spark2'};
    writeFileSync(p,JSON.stringify(j));
  }});
  Object.assign(T,{fleet,base:fleet.base,origin:fleet.origin,mcp:fleet.mcp});
  const id=await newChat();
  pending=fetch(fleet.base+'/chats/'+id+'/messages',{method:'POST',headers:{'content-type':'application/json','x-spark-console':'1',origin:fleet.origin},body:JSON.stringify({text:'hello'}),signal:controller.signal}).then(r=>r.text()).catch(e=>e.name);
  await got;await new Promise(r=>setTimeout(r,500));
  const before=(await api('/chats')).json.chats.find(c=>c.id===id);assert.equal(before.replying,true);
  const stop=await api('/chats/'+id+'/messages',{method:'POST',body:{text:'/stop'}});assert.equal(stop.status,200);
  await new Promise(r=>setTimeout(r,1500));
  const after=(await api('/chats')).json.chats.find(c=>c.id===id);
  const retry=await api('/chats/'+id+'/messages',{method:'POST',body:{text:'try again'}});
  const result={case:'stop-does-not-release-truncated-model-response',replyingBeforeStop:before.replying,stopStatus:stop.status,stopClaimedStopped:stop.text.includes('Stopped. Sparkie'),replyingAfterStop:after.replying,retryStatus:retry.status,retryError:retry.json?.error};
  console.log(JSON.stringify(result,null,2));
  assert.equal(after.replying,true);assert.equal(retry.status,409);

} finally {controller.abort();await pending;await fleet?.stop();await new Promise(r=>model.close(r));}
