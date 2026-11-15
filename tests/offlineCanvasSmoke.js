// Manual acceptance: node tests/offlineCanvasSmoke.js <saved-study.html> [screenshot.png]
// Retains the isolated Chrome profile and all generated artifacts.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
async function until(action) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const value = await action();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Canvas acceptance condition timed out');
}
async function main() {
  assert.ok(process.argv[2], 'Provide saved study HTML');
  const filename = path.resolve(process.argv[2]);
  await fs.access(filename);
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'sentence-canvas-chrome-'));
  const chrome = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe');
  const child = spawn(chrome, ['--headless=new','--disable-gpu','--disable-background-networking',
    '--disable-extensions','--no-first-run','--no-default-browser-check','--window-size=1440,1000',
    '--remote-debugging-port=0','--remote-debugging-address=127.0.0.1',`--user-data-dir=${profile}`,'about:blank'],
  {windowsHide:true,stdio:'ignore'});
  let socket, send, startupError;
  child.on('error', error => { startupError = error; });
  try {
    const port = await until(async () => {
      if (startupError) throw startupError;
      try { return (await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).trim().split(/\r?\n/); }
      catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    });
    socket = new WebSocket(`ws://127.0.0.1:${port[0]}${port[1]}`);
    await new Promise((resolve,reject) => { socket.onopen=resolve; socket.onerror=reject; });
    const pending = new Map(), requests = [], errors = [];
    let id = 0;
    socket.onmessage = event => {
      const data = JSON.parse(event.data);
      if (data.method === 'Network.requestWillBeSent') requests.push(data.params.request.url);
      if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails.text);
      const item = pending.get(data.id);
      if (item) { pending.delete(data.id); clearTimeout(item.timer); data.error ? item.reject(new Error(data.error.message)) : item.resolve(data.result); }
    };
    send = (method,params={},sessionId) => new Promise((resolve,reject) => {
      const current=++id;
      const timer=setTimeout(()=>{pending.delete(current);reject(new Error('CDP timeout: '+method));},10000);
      pending.set(current,{resolve,reject,timer});
      socket.send(JSON.stringify({id:current,method,params,...(sessionId?{sessionId}:{})}));
    });
    const {targetId}=await send('Target.createTarget',{url:'about:blank'});
    const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
    for (const method of ['Page.enable','Network.enable','Runtime.enable']) await send(method,{},sessionId);
    await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0},sessionId);
    await send('Page.navigate',{url:pathToFileURL(filename).href},sessionId);
    async function evaluate(expression) {
      const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);
      if(result.exceptionDetails)throw new Error(result.exceptionDetails.text);
      return result.result.value;
    }
    await until(()=>evaluate(`document.querySelector('.diagram-canvas')?.dataset.zoom`));
    const summary=await evaluate(`({canvases:document.querySelectorAll('.diagram-canvas').length,expandLinks:document.querySelectorAll('.diagram-open').length,images:document.images.length,source:!!document.querySelector('.para-text')?.textContent})`);
    assert.ok(summary.canvases>=2);assert.equal(summary.expandLinks,0);assert.equal(summary.canvases,summary.images);assert.ok(summary.source);
    // Visit the tallest diagrams as well as the first: lazy loading must also fit.
    const sampleIndices=await evaluate(`(() => {
      const roots=[...document.querySelectorAll('.diagram-canvas')];
      const reported=['Jem took me to his room','Try to go to sleep','To reach the courtroom'].map(phrase=>roots.findIndex(root=>root.closest('.sent-card')?.textContent.includes(phrase))).filter(index=>index>=0);
      return [...new Set([0,1,...reported,...roots.map((root,index)=>{
        const image=root.querySelector('img');
        const svg=image.src.startsWith('data:image/svg+xml;base64,') ? new DOMParser().parseFromString(atob(image.src.split(',')[1]),'image/svg+xml').documentElement : null;
        return {index,ratio:svg?parseFloat(svg.getAttribute('height'))/parseFloat(svg.getAttribute('width')):0};
      }).sort((a,b)=>b.ratio-a.ratio).slice(0,3).map(item=>item.index)])];
    })()`);
    const autoFitResults=[];
    for(const index of sampleIndices) {
      await evaluate(`document.querySelectorAll('.diagram-canvas')[${index}].scrollIntoView({block:'center'})`);
      await until(()=>evaluate(`!!document.querySelectorAll('.diagram-canvas')[${index}].dataset.zoom`));
      const bounds=await evaluate(`(() => {const root=document.querySelectorAll('.diagram-canvas')[${index}],image=root.querySelector('img'),z=Number(root.dataset.zoom),x=Number(root.dataset.panX),y=Number(root.dataset.panY);return {x,y,right:x+image.naturalWidth*z,bottom:y+image.naturalHeight*z,width:root.clientWidth,height:root.clientHeight,zoom:z};})()`);
      assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.right<=bounds.width+1&&bounds.bottom<=bounds.height+1,'Initial diagram must fit completely: '+index);
      assert.ok(bounds.height<=1800,'Frame height must remain bounded');
      autoFitResults.push({index,height:bounds.height,zoom:Math.round(bounds.zoom*100)+'%'});
    }
    await evaluate(`window.testCanvas=document.querySelector('.diagram-canvas');window.testOther=document.querySelectorAll('.diagram-canvas')[1];`);
    const otherZoom=await evaluate(`testOther.dataset.zoom`);
    async function position() {
      return evaluate(`(() => {testCanvas.scrollIntoView({block:'center'});const r=testCanvas.getBoundingClientRect();return {x:r.x+160,y:Math.max(100,r.y+100)};})()`);
    }
    const zoomBefore=await evaluate(`testCanvas.dataset.zoom`);
    let point=await position();
    const scrollBefore=await evaluate(`document.getElementById('panelRight').scrollTop`);
    await send('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY:120},sessionId);
    await until(async()=>await evaluate(`document.getElementById('panelRight').scrollTop`) > scrollBefore);
    assert.equal(await evaluate(`testCanvas.dataset.zoom`),zoomBefore,'Inactive wheel must scroll the article');
    point=await position();
    await send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1},sessionId);
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1},sessionId);
    assert.equal(await evaluate(`testCanvas.dataset.active`),'true');
    await send('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY:-120},sessionId);
    await until(async()=>Number(await evaluate(`testCanvas.dataset.zoom`)) > Number(zoomBefore));
    await evaluate(`testCanvas.querySelector('[data-canvas-action="actual"]').click();for(let n=0;n<3;n++)testCanvas.querySelector('[data-canvas-action="in"]').click();`);
    const beforeDrag=await evaluate(`testCanvas.dataset.panX`);
    await send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1},sessionId);
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x-100,y:point.y-40,button:'left',buttons:1},sessionId);
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x-100,y:point.y-40,button:'left',clickCount:1},sessionId);
    assert.notEqual(await evaluate(`testCanvas.dataset.panX`),beforeDrag,'Dragging must translate the image');
    if(otherZoom)assert.equal(await evaluate(`testOther.dataset.zoom`),otherZoom,'Each canvas must keep independent zoom');
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},sessionId);
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},sessionId);
    assert.equal(await evaluate(`testCanvas.dataset.active`),'false');
    const manualZoom=await evaluate(`testCanvas.dataset.zoom`);
    const widthBefore=await evaluate(`testCanvas.clientWidth`);
    await evaluate(`const slider=document.getElementById('columnWidth');slider.value='25';slider.dispatchEvent(new Event('input',{bubbles:true}));`);
    await until(async()=>await evaluate(`testCanvas.clientWidth`) !== widthBefore);
    assert.equal(await evaluate(`testCanvas.dataset.zoom`),manualZoom,'Resizing columns must preserve manually selected zoom');
    await evaluate(`testCanvas.querySelector('[data-canvas-action="fit"]').click();`);
    const fit=await evaluate(`({zoom:Number(testCanvas.dataset.zoom),width:testCanvas.clientWidth,height:testCanvas.clientHeight,imageWidth:testCanvas.querySelector('img').naturalWidth,imageHeight:testCanvas.querySelector('img').naturalHeight})`);
    assert.ok(fit.imageWidth*fit.zoom<=fit.width&&fit.imageHeight*fit.zoom<=fit.height);
    if(process.argv[3]) {
      const screenshot=await send('Page.captureScreenshot',{format:'png'},sessionId);
      await fs.writeFile(path.resolve(process.argv[3]),Buffer.from(screenshot.data,'base64'));
    }
    assert.equal(requests.filter(url=>/^https?:/i.test(url)).length,0);assert.deepEqual(errors,[]);
    console.log(JSON.stringify({status:'PASS',filename,...summary,autoFitSamples:autoFitResults,networkRequests:0,errors,checks:['initial and lazy-loaded diagrams fit','inactive wheel scrolls article','active wheel zoom','pointer pan','independent canvases','Escape releases wheel','column resizing preserves zoom','fit bounds','offline assets']},null,2));
  } finally {
    if(send){try{await send('Browser.close');}catch{}}
    if(socket)socket.close();
    if(child.exitCode===null)child.kill();
  }
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
