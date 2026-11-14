import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const reviewRoot=resolve(process.env.SPARK_REVIEW_ROOT || fileURLToPath(new URL('../../../../',import.meta.url)));
// End-to-end confirmation: isolated service and real file worker under mock HOME.
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import http from 'node:http';
const {startMock} = await import(pathToFileURL(join(reviewRoot,'test/start-mock.mjs')).href);
const fleet=await startMock({watchMs:60000,statusMs:60000,timeoutMs:90000});
try {
  const folder=join(fleet.root,'spark4/.local/share/spark-portal/workspaces/shared');
  mkdirSync(folder,{recursive:true,mode:0o700});
  const original={spark:'spark4',path:'prices.txt',text:'Price: €10 — café 😀'};
  const wire=Buffer.from(JSON.stringify(original)),split=wire.indexOf(Buffer.from('€'))+1;
  const response=await new Promise((resolve,reject)=>{
    const req=http.request(fleet.base+'/actions/save_file',{method:'POST',headers:{'content-type':'application/json','content-length':wire.length,'x-spark-console':'1',origin:fleet.origin}},res=>{
      const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,text:Buffer.concat(chunks).toString()}));res.on('error',reject);
    });
    req.on('error',reject);
    req.write(wire.subarray(0,split));
    setTimeout(()=>req.end(wire.subarray(split)),100);
  });
  assert.equal(response.status,200,response.text);
  const persisted=readFileSync(join(folder,'prices.txt'),'utf8');
  console.log('HTTP response:',response.status,response.text);
  console.log('Submitted:',JSON.stringify(original.text));
  console.log('Actual file:',JSON.stringify(persisted));
  assert.equal(persisted,'Price: ���10 — café 😀');
  console.log('CONFIRMED end to end: service returned saved and real worker persisted corrupted text.');
} finally {await fleet.stop();}
