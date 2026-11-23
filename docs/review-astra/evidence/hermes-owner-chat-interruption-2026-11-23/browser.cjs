const {chromium} = require('/opt/browser/node_modules/playwright');
const fs = require('node:fs');
const mode = process.env.UPLOAD_VIEWPORT || 'desktop';
const width = mode === 'phone' ? 390 : 1280;
const height = mode === 'phone' ? 844 : 850;
const markers = {first:'I will inspect the synthetic check.', interpretation:'The recorded checker result is seven for beta.', raw:'RAW-EVIDENCE-KITE-5807', owner:'disposable study'};
const result = {viewport:{width,height}, rpc:[], http:[], phases:{}};
function summarize(text) {return Object.fromEntries(Object.entries(markers).map(([k,v])=>[k,text.includes(v)]));}
function record(name, val){result.phases[name]=val;fs.writeFileSync('/results/browser.json',JSON.stringify(result,null,2));}
function clean(text) {return text.replace(/http\S+/g,'[URL]').slice(0,1300);}
async function capture(page, name) {
  const text = await page.locator('body').innerText();
  const nodes=await page.locator('[data-role="assistant"]').allInnerTexts();
  const buttons=await page.locator('[data-role="assistant"] button:visible').evaluateAll(bs=>bs.map(b=>({label:b.getAttribute('aria-label'),title:b.title,text:b.innerText.slice(0,110),expanded:b.getAttribute('aria-expanded')})));
  record(name,{...summarize(text),assistantRows:nodes.map(clean),buttons});
}
async function reveal(page, name) {
 const ops=[];
 for(let i=0;i<12;i++){
  const bs=page.locator('[data-role="assistant"] button[aria-expanded="false"]:visible');
  if(!await bs.count())break;
  const b=bs.first();
  ops.push(await b.evaluate(e=>({label:e.getAttribute('aria-label'), text:e.innerText.slice(0,110),title:e.title})));
  try {await b.click({timeout:1500});}
  catch(error){ops.push({error:clean(String(error)).slice(0,450)});break;}
  await page.waitForTimeout(200);
 }
 record(name+'Actions',ops);
 await capture(page,name);
}
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const context=await browser.newContext({viewport:{width,height}});
  const page=await context.newPage();
  page.on('websocket',w=>{w.on('framesent',m=>{try{const f=JSON.parse(m.payload);if(f.method)result.rpc.push(f.method);}catch {}});});
  page.on('response',async response=>{try{const path=new URL(response.url()).pathname;if(path.includes('session')||path.includes('transcript')){
    const body=await response.text();
    result.http.push({path:path.replace(/[a-zA-Z0-9_-]{18,}/g,'[id]'),status:response.status(),...summarize(body)});
  }}catch{}});
  const auth=fs.readFileSync('/results/link','utf8').trim();
  const pre=await context.request.get('http://127.0.0.1:9120/api/sessions');
  result.unauthenticatedStatus=pre.status();
  result.unauthenticatedType=pre.headers()['content-type'];
  const guest = await context.newPage();
  await guest.goto('http://127.0.0.1:9120/webapp/');
  result.unsignedSocket=await guest.evaluate(()=>new Promise(resolve=>{
    let opened=false;
    const sock=new WebSocket('ws://127.0.0.1:9120/api/ws');
    sock.onopen=()=>{opened=true;};
    sock.onclose=e=>resolve({opened,closeCode:e.code});
    setTimeout(()=>{sock.close();resolve({opened,closeCode:null});},1500);
  }));
  await guest.close();
  await page.goto(auth);
  const editor=page.locator('[data-slot="composer-root"] [contenteditable="true"]').first();
  await editor.waitFor({timeout:40000});
  const dismiss=page.getByRole('button',{name:'No thanks',exact:true});
  if(await dismiss.isVisible())await dismiss.click();
  await page.waitForTimeout(1500);
  await editor.click(); await editor.pressSequentially('Run the disposable study and report the observation.');
  for(let i=0;i<5&&!result.rpc.includes('prompt.submit');i++){await editor.press('Enter');await page.waitForTimeout(900);}
  const until=Date.now()+42000;
  while(Date.now()<until&&!fs.existsSync('/results/waiting-for-cancel'))await page.waitForTimeout(300);
  if(!fs.existsSync('/results/waiting-for-cancel'))throw Error('The scripted provider did not receive both native tool results.');
  await page.waitForTimeout(600);
  await capture(page,'liveDefault');
  await reveal(page,'liveExpanded');
  await page.screenshot({path:'/results/live.png'});
  const stop=page.getByRole('button',{name:/stop generating|stop response|stop agent|^stop$/i}).first();
  if(!await stop.isVisible()) {result.stopCandidates=await page.locator('button:visible').evaluateAll(bs=>bs.map(b=>[b.title,b.getAttribute('aria-label'),b.innerText]).filter(v=>v.some(Boolean)));throw Error('No native stop control.');}
  await stop.click();
  await page.waitForTimeout(450);
  fs.writeFileSync('/results/cancel-sent','owner clicked stop');
  await page.waitForTimeout(4800);
  await capture(page,'stopped');
  await page.screenshot({path:'/results/stopped.png'});
  result.interruptSent=result.rpc.includes('session.interrupt');
  await page.reload({waitUntil:'domcontentloaded'});
  await editor.waitFor({timeout:30000});
  await page.waitForTimeout(3500);
  await capture(page,'reloadDefault');
  await reveal(page,'reloadExpanded');
  await page.screenshot({path:'/results/reload.png'});
 }catch(e){result.error=clean(String(e));process.exitCode=1;}
 finally {await browser.close();fs.writeFileSync('/results/browser.json',JSON.stringify(result,null,2));fs.writeFileSync('/results/finished','done');}
})();
