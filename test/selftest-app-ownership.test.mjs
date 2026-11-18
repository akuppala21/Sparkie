// Covers: A real self-test web app adopted by the owner while its readiness check is pending remains running across
// a service crash and delayed cleanup, even before the older test could record its web receipt. Stand-ins only.
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import http from 'node:http';
import {T,useFleet,api,waitFor,SERVICE_FILE,REPO,SLOW} from './lib.mjs';
let second=null,answer=false; const pending=[];
const page=http.createServer((req,res)=>{if(answer){res.writeHead(200);res.end('self-test');}else pending.push(res);});
await new Promise(r=>page.listen(0,'127.0.0.1',r));
after(()=>{try{second?.kill('SIGKILL');}catch{} page.closeAllConnections();page.close();});
useFleet({watchMs:2000,statusMs:3000,env:{SPARK_CONSOLE_SELFTEST_PORT:String(page.address().port),SPARK_CONSOLE_APP_ANSWER_MS:'60000'},prepare:({root,stateDir})=>{
 const at=ms=>new Date(Date.now()-ms).toISOString();
 writeFileSync(join(stateDir,'events.jsonl'),[{at:at(8*3600000),type:'spark-offline',spark:'spark3'},{at:at(10*60000),type:'spark-online',spark:'spark3',upSeconds:45}].map(JSON.stringify).join('\n')+'\n');
 const mock=join(root,'spark3','.mock'),list=join(mock,'containers');
 writeFileSync(list,readFileSync(list,'utf8').replace(/^(sc-testorg--Qwen3\.8-27B-abliterated-GGUF)\|running\|[^|]*\|/m,'$1|exited|Exited (0) 2 hours ago|'));
 for(const f of ['jobs-run','stamp-starts','ids-per-run'])writeFileSync(join(mock,f),'');
}});
const running=name=>readFileSync(join(T.fleet.root,'spark3','.mock','containers'),'utf8').split('\n').some(l=>l.split('|')[0]===name&&l.split('|')[1]==='running');
test('delayed self-test cleanup preserves an app genuinely adopted by its owner',{timeout:240000*SLOW},async()=>{
 const noteFile=join(T.fleet.stateDir,'self-test.json'),mock=f=>join(T.fleet.root,'spark3','.mock',f);
 const start=await api('/actions/self_test',{method:'POST',body:{spark:'spark3'}});assert.equal(start.status,200,start.text);assert.equal(start.json.outcome,'started');
 const rec=await waitFor(()=>{try{const r=JSON.parse(readFileSync(noteFile,'utf8'));return r.web?.container&&running(r.web.container)?r:null;}catch{return null;}},{timeout:120000,every:100,what:'real self-test web app running while its endpoint waits'});
 const name=rec.web.container,id=readFileSync(mock('id-'+name),'utf8').trim();
 process.kill(T.fleet.servicePid(),'SIGKILL');await waitFor(()=>T.fleet.serviceExit(),{timeout:10000,what:'service crash'});
 answer=true;for(const res of pending){res.writeHead(200);res.end('self-test');}
 second=spawn(process.execPath,[SERVICE_FILE],{cwd:REPO,env:{...T.fleet.env,SPARK_CONSOLE_SELFTEST_RECOVER_MS:'60000'},stdio:'ignore'});
 await waitFor(async()=>(await api('/health').catch(()=>null))?.status===200,{timeout:30000,what:'service back'});
 const adopt=await api('/actions/keep_running',{method:'POST',body:{spark:'spark3',container:name}});
 assert.equal(adopt.status,200,adopt.text);assert.ok(['kept','already'].includes(adopt.json.outcome),adopt.text);
 const desired=JSON.parse(readFileSync(join(T.fleet.stateDir,'desired.json'),'utf8'));assert.ok(desired.running.some(x=>x.spark==='spark3'&&x.container===name));
 assert.equal(readFileSync(mock('id-'+name),'utf8').trim(),id);assert.ok(running(name));
 console.log(JSON.stringify({evidence:'genuine owner app adoption accepted',outcome:adopt.json.outcome,sameId:true,desired:true,running:true,recordHadId:Boolean(rec.web.id)}));
 await waitFor(()=>!existsSync(noteFile),{timeout:120000,what:'delayed self-test cleanup finished'});
 console.log(JSON.stringify({evidence:'after delayed self-test cleanup',running:running(name)}));
 assert.ok(running(name),'self-test cleanup stopped an app the owner adopted after the service restart');
});
