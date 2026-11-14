'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const reviewRoot = path.resolve(process.env.SPARK_REVIEW_ROOT || path.join(__dirname,'../../../..'));
const playwrightModule = process.env.PLAYWRIGHT_MODULE || (() => {
  try { return require.resolve('playwright'); }
  catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    return path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  }
})();
const { chromium } = require(playwrightModule);
const source = fs.readFileSync(path.join(reviewRoot,'public/app.js'), 'utf8').replace(/\nstart\(\);\s*$/, '\n');
(async () => {
 const browser = await chromium.launch({channel:'chrome',headless:true,args:['--no-proxy-server']});
 try {
  const page = await browser.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>route.abort());
  await page.setContent('<html><body><div id="view"></div></body></html>');
  await page.addScriptTag({content:source});
  await page.evaluate(()=>{
    window.reviewCalls=[]; toast=()=>{};
    state.boot={userName:'Reviewer',viewer:{role:'member',permissions:{files:'write',sharedFiles:'write',nodeIds:['spark3','spark4'],chat:true}},nodes:[{id:'spark3',name:'Spark 3',configured:true},{id:'spark4',name:'Spark 4',configured:true}]};
    state.status={updatedAt:new Date().toISOString(),nodes:[{id:'spark3',state:'online',reachable:true},{id:'spark4',state:'online',reachable:true}]};
    capi=async(path,method,body)=>{reviewCalls.push({path,method,body}); return new Promise(resolve=>window.releaseList=resolve);};
    document.querySelector('#view').append(filesBrowser('spark3'));
  });
  const beforeSwitch = await page.evaluate(()=>({node:state.files.node,busy:state.files.busy,epoch:state.files.epoch,calls:reviewCalls.length}));
  await page.evaluate(()=>{
    document.querySelector('#view').replaceChildren(filesBrowser('spark4'));
    releaseList({entries:[{name:'only-on-spark3.txt',kind:'file',size:12}],total:1});
  });
  await page.waitForTimeout(30);
  const afterResponse=await page.evaluate(()=>({node:state.files.node,busy:state.files.busy,epoch:state.files.epoch,entries:state.files.entries,calls:reviewCalls,visibleText:document.body.textContent}));
  await page.evaluate(()=>document.querySelector('#view').replaceChildren(filesBrowser('spark4')));
  const afterRevisit=await page.evaluate(()=>({visibleText:document.body.textContent,calls:reviewCalls}));
  assert.equal(afterResponse.node,'spark4');
  assert.equal(afterResponse.calls.length,1);
  assert.equal(afterResponse.entries[0].name,'only-on-spark3.txt');
  assert.ok(afterRevisit.visibleText.includes('Spark 4'));
  assert.ok(afterRevisit.visibleText.includes('only-on-spark3.txt'));
  console.log(JSON.stringify({case:'cross-node-stale-list',beforeSwitch,afterResponse,afterRevisit}));

  await page.evaluate(()=>{
    reviewCalls.length=0;
    Object.assign(state.files,{node:'spark3',area:'personal',path:'',entries:[],busy:false,error:null,epoch:20,maxFileBytes:1024});
    capi=async(path,method,body)=>{
      reviewCalls.push({path,method,body});
      if(body.operation==='write'&&body.path==='first.txt')return new Promise(resolve=>window.releaseWrite=resolve);
      return {entries:[],total:0,saved:true};
    };
    document.querySelector('#view').replaceChildren(filesBrowser('spark3'));
    const input=document.querySelector('input[type=file]');
    Object.defineProperty(input,'files',{value:[new File(['first'],'first.txt'),new File(['private document'],'second-private.txt')],configurable:true});
    input.dispatchEvent(new Event('change'));
  });
  await page.waitForFunction(()=>typeof releaseWrite==='function');
  await page.evaluate(()=>{
    state.files.area='shared';state.files.node=null;
    document.querySelector('#view').replaceChildren(filesBrowser('spark3'));
    releaseWrite({saved:true});
  });
  await page.waitForFunction(()=>reviewCalls.some(r=>r.body.path==='second-private.txt'));
  const writes=await page.evaluate(()=>reviewCalls.filter(r=>r.body.operation==='write').map(r=>({path:r.path,file:r.body.path,area:r.body.area})));
  assert.equal(writes[0].area,'personal');assert.equal(writes[1].area,'shared');
  console.log(JSON.stringify({case:'multi-file-upload-changes-destination',writes}));
  await page.evaluate(()=>{
    reviewCalls.length=0; state.boot.viewer.role='owner';
    const model={name:'review-model',repo:'review/model',sizeBytes:10,copies:['spark3','spark4']};
    const one=(node,container)=>({node,model:{engine:'test'},steps:[{kind:'stop',container,gpuMiB:1}],memory:{available:1e10,need:1},warnings:[]});
    state.lib.data={library:[model],sparks:['spark3','spark4'].map(id=>({id,online:true,models:['review-model'],deployments:[]}))};
    const pairPlan={nodes:['spark3','spark4'],each:1,members:['spark3','spark4'].map(id=>({...one(id,'PAIR-'+id),stop:['PAIR-'+id]}))};
    capi=async(path,method,body)=>{
      reviewCalls.push({path,method,body});
      if(path.startsWith('deploy/plans?'))return {recommended:'spark3',sparks:['spark3','spark4'].map(id=>({node:id,fits:true,stop:['SINGLE-'+id],plan:one(id,'SINGLE-'+id)})),pairs:[{nodes:['spark3','spark4'],fits:true,stop:[]}]};
      if(path.startsWith('deploy/cluster-plan?'))return new Promise(resolve=>window.releasePair=()=>resolve(pairPlan));
      return {accepted:true};
    };
    dialog=async opts=>{
      window.reviewDialog=opts;
      const box=document.querySelector('#view');box.replaceChildren(...opts.body);
      const ok=document.createElement('button');ok.textContent='Start';box.append(ok);opts.setup({ok});
      return new Promise(()=>{});
    };
    openDeploy(model);
  });
  await page.waitForSelector('input[name=deploy-spark][value="spark3+spark4"]');
  await page.locator('input[name=deploy-spark][value="spark3+spark4"]').check();
  await page.waitForFunction(()=>typeof releasePair==='function');
  await page.locator('input[name=deploy-spark][value="spark4"]').check();
  const planBefore=await page.locator('.plan').textContent();
  await page.evaluate(()=>releasePair());
  await page.waitForFunction(()=>document.querySelector('.plan').textContent.includes('PAIR-spark3'));
  const planRace=await page.evaluate(async()=>{
    const selected=document.querySelector('input[name=deploy-spark]:checked').value;
    const shown=document.querySelector('.plan').textContent;
    await reviewDialog.onConfirm();
    return {selected,shown,posted:reviewCalls.filter(r=>r.method==='POST')};
  });
  assert.equal(planRace.selected,'spark4');
  assert.equal(planRace.posted[0].body.node,'spark4');
  assert.deepEqual(planRace.posted[0].body.stop,['spark3/PAIR-spark3','spark4/PAIR-spark4']);
  console.log(JSON.stringify({case:'deploy-plan-cross-selection-race',planBefore,...planRace}));
  console.log(JSON.stringify({pageErrors:errors,network:'all browser requests aborted; API function stubbed'}));
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
