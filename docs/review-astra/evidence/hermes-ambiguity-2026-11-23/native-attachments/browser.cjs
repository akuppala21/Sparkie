const {chromium} = require('/opt/browser/node_modules/playwright');
const fs = require('node:fs');
(async () => {
 const viewport=process.env.UPLOAD_VIEWPORT==='phone' ? {width:390,height:844} : {width:1280,height:850};
 const result = {viewport,http:[],rpc:[]};
 const browser = await chromium.launch({executablePath:'/usr/bin/chromium', args:['--no-sandbox','--disable-dev-shm-usage']});
 try {
  const page = await browser.newPage({viewport});
  page.on('response', r => {const path=new URL(r.url()).pathname; if(path.includes('upload')) result.http.push({path,status:r.status()});});
  page.on('websocket', w => w.on('framesent', m => {
    try {const f=JSON.parse(m.payload); if(['file.attach','prompt.submit'].includes(f.method))
      result.rpc.push({method:f.method, stagedUpload:!!f.params.staged_upload, reference:JSON.stringify(f.params).includes('@file:'), typedMarker:JSON.stringify(f.params).includes('EVIDENCE-MALLOW-7249')});} catch {}
  }));
  await page.goto(fs.readFileSync('/results/link','utf8').trim());
  const editor=page.locator('[data-slot="composer-root"] [contenteditable="true"]').first();
  await editor.waitFor({timeout:40000});
  const dismiss=page.getByRole('button',{name:'No thanks',exact:true});
  if(await dismiss.isVisible()) await dismiss.click();
  await page.waitForTimeout(1500);
  await page.getByRole('button',{name:'Add context',exact:true}).click();
  const [chooser]=await Promise.all([page.waitForEvent('filechooser',{timeout:7000}),page.getByRole('menuitem',{name:/^Files/}).click()]);
  await chooser.setFiles({name:'exhibit-check.txt',mimeType:'text/plain',buffer:Buffer.from('EVIDENCE-MALLOW-7249\n')});
  await page.waitForFunction(()=>document.body.innerText.includes('exhibit-check.txt'),{},{timeout:15000});
  await editor.click(); await editor.press('End'); await editor.pressSequentially(' What is the exhibit check? Also inspect @file:/tmp/secondary-profile/attachments/private-scope-note.txt.');
  for(let i=0;i<10&&!result.rpc.some(r=>r.method==='prompt.submit');i++){await editor.press('Enter');await page.waitForTimeout(1100);}
  await page.getByText('UPLOAD CAPTURED',{exact:true}).first().waitFor({timeout:50000});
  result.rendered=true;
  result.bodyWidth=await page.evaluate(()=>document.documentElement.scrollWidth);
 }catch(e){result.error=String(e).slice(0,700);process.exitCode=1;}
 finally {await browser.close();fs.writeFileSync('/results/browser.json',JSON.stringify(result,null,2));fs.writeFileSync('/results/finished','done');}
})()
