const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');const {pathToFileURL}=require('node:url');
const {createApp}=require('../server');const {openBrowser}=require('./browserHarness');
async function main(){
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'canvas-reach-'));const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="5000"><rect width="800" height="5000" fill="white"/><text x="20" y="50">TOP</text><rect x="20" y="4900" width="740" height="70" fill="green"/><text x="30" y="4950">BOTTOM</text></svg>');
 const app=createApp({outputDir:temp,delayMs:0,analyzeSentence:async text=>({sentenceType:'简单句',translation:'验收译文',parts:[{text,role:'主句',translation:'验收译文'}]}),renderDiagram:async()=>({buffer:svg,mimeType:'image/svg+xml'})});const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let browser;
 async function stop(){if(server.listening){server.closeAllConnections();await new Promise(r=>server.close(r));}app.locals.closeVocabulary();}
 try{browser=await openBrowser();const {evaluate,until}=browser;const base='http://127.0.0.1:'+server.address().port;
  const events=await fetch(base+'/api/process',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'Rain fell.',reviewed:true})}).then(r=>r.text());const id=JSON.parse(events.match(/event: complete\ndata: (.+)/)[1]).resultId;const result=await fetch(base+'/api/result/'+id).then(r=>r.json());
  async function verify(){
   await until(()=>evaluate('!!document.querySelector(".diagram-canvas")?.dataset.zoom'));
   await evaluate('document.getElementById("panelRight").scrollTop=0');
   const point=await evaluate('(()=>{const r=document.querySelector(".diagram-canvas").getBoundingClientRect();return {x:r.left+100,y:r.top+130};})()');
   await browser.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await browser.call('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,x:point.x,y:point.y-7000});await browser.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:point.x,y:point.y-7000});
   const bounds=await evaluate('(()=>{const root=document.querySelector(".diagram-canvas"),image=root.querySelector("img"),r=root.getBoundingClientRect(),i=image.getBoundingClientRect(),panel=document.getElementById("panelRight").getBoundingClientRect();return {bottom:i.bottom,visibleBottom:Math.min(r.bottom,panel.bottom,innerHeight),imageHeight:i.height,frameHeight:root.clientHeight};})()');
   assert.ok(bounds.frameHeight>1000,'fixture must exceed the visible window');assert.ok(bounds.bottom<=bounds.visibleBottom-5,'bottom of tall diagram must be reachable in the visible panel: '+JSON.stringify(bounds));
   await evaluate('document.querySelector("[data-canvas-action=fit]").click()');
   const fit=await evaluate('(()=>{const r=document.querySelector(".diagram-canvas"),i=r.querySelector("img");return {y:Number(r.dataset.panY),z:Number(r.dataset.zoom),height:r.clientHeight,natural:i.naturalHeight};})()');assert.ok(fit.y>=0&&fit.y+fit.z*fit.natural<=fit.height);
  }
  await browser.navigate(base+result.outputUrl);await verify();await stop();const before=browser.requests.length;await browser.navigate(pathToFileURL(path.join(temp,result.filename)).href);await verify();assert.deepEqual(browser.errors,[]);assert.equal(browser.requests.slice(before).some(url=>/^https?:/.test(url)),false);console.log('Tall diagram reach passed online and offline: bottom accessible by dragging, fit preserved, no script errors.');
 }finally{await browser?.close();await stop();}
}main().catch(error=>{console.error(error);process.exitCode=1;});
