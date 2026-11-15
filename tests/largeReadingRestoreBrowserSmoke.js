// Restore an existing large result in an isolated workspace without changing user progress.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {sourceText}=require('../services/epubIntegrity');
const {buildCompleteStudyHtml}=require('../services/htmlBuilder');
const {createApp}=require('../server');
const {loadSavedResult}=require('../services/readerSessionRoutes');
const {openBrowser}=require('./browserHarness');

async function main(){
 const source=path.resolve(process.argv[2]||'outputs/sentence-decomposition-20261111-205417.html');
 const result=await loadSavedResult(path.dirname(source),path.basename(source));
 const expected=result.sections.reduce((n,s)=>n+s.sentences.length,0);
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'large-reader-'));
 const sessionDir=path.join(directory,'session');await fs.mkdir(sessionDir);
 let state={schema:1,input:{text:'',paragraphMode:'preserve'},preview:{text:result.sections.map(s=>s.paragraph).join('\n\n'),warnings:[]},
  resultFilename:path.basename(source),selectedSentence:'1',layout:{inputExpanded:true,epubCollapsed:true,previewCollapsed:false,columnWidth:40}};
 if(process.argv[3]){
  const workspace=path.resolve(process.argv[3]);state=JSON.parse(await fs.readFile(workspace,'utf8')).state;
  assert.equal(state.resultFilename,path.basename(source));
  if(state.bookId){await fs.mkdir(path.join(sessionDir,'books'));await fs.copyFile(path.join(path.dirname(workspace),'books',state.bookId+'.epub'),path.join(sessionDir,'books',state.bookId+'.epub'));}
 }
 await fs.writeFile(path.join(sessionDir,'workspace.json'),JSON.stringify({state,revision:0}));
 const stages=[];
 const app=createApp({outputDir:path.dirname(source),sessionDir,vocabularyPath:path.join(directory,'vocabulary.sqlite'),
  analyzeSentence:async()=>{throw Error('Unexpected model call');},directoryModel:async()=>{throw Error('Unexpected model call');}});
 app.post('/perf-stage',(req,res)=>{stages.push({stage:req.query.stage,time:performance.now()});res.end();});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 let browser;
 try{
  browser=await openBrowser();await browser.call('Network.disable');
  await browser.call('Page.addScriptToEvaluateOnNewDocument',{source:`
   window.perfTicks=0;window.perfMaxGap=0;let previous=performance.now();
   setInterval(()=>{const now=performance.now();window.perfMaxGap=Math.max(window.perfMaxGap,now-previous);previous=now;window.perfTicks++;},50);
   for(const name of ['InlineDiagramCanvas','EpubOriginal','ReadingWorkspace','Vocabulary']){
    let value;Object.defineProperty(window,name,{configurable:true,get:()=>value,set(api){value=api;const mount=api.mount;
     api.mount=function(...args){if(location.protocol==='http:')navigator.sendBeacon('/perf-stage?stage='+name+'-start');const r=mount.apply(this,args);if(location.protocol==='http:')navigator.sendBeacon('/perf-stage?stage='+name+'-end');return r;};
     ${process.env.READER_SKIP_CANVAS?'if(name==="InlineDiagramCanvas")api.mount=()=>{};':''}
    }});
   }
  `});
  const start=performance.now();await browser.navigate('http://127.0.0.1:'+server.address().port);
  await browser.until(()=>browser.evaluate('typeof busy!=="undefined"&&!busy&&document.getElementById("sessionStatus").textContent.includes("已保存")'),15000);
  await browser.until(()=>browser.evaluate('!document.getElementById("readingModeToggle").disabled&&!!document.querySelector(".epub-original-frame")?.contentDocument.querySelector(".study-original-sentence")'),15000);
  const metrics=await browser.evaluate(`({ticks:perfTicks,maxGap:Math.round(perfMaxGap),cards:document.querySelectorAll('#rightContent>.sent-card').length,
   text:[...document.querySelectorAll('#leftContent .para-text')].map(p=>p.textContent).join(''),selected:typeof selectedSentence!=='undefined'&&selectedSentence,
   initialized:document.querySelectorAll('.diagram-canvas[data-zoom]').length,
   images:[...document.querySelectorAll('#rightContent img')].filter(i=>!!i.getAttribute('src')).length})`);
  console.log(JSON.stringify({status:'RESTORED',expected,restoreMs:Math.round(performance.now()-start),...metrics,text:undefined,stages:stages.map(s=>s.stage)}));
  assert.ok(metrics.maxGap<2500,'Restoration must not freeze the page for multiple seconds');
  assert.equal(metrics.cards,expected,'Every sentence must keep an identifiable result entry');
  assert.ok(metrics.text.replace(/\s/g,'')===result.sections.map(s=>s.paragraph).join('').replace(/\s/g,''),'Full source text must remain visible');
  assert.equal(metrics.selected,state.selectedSentence);
  assert.ok(metrics.initialized<30,'Opening a long result should initialize nearby diagrams instead of every diagram');
  const actualOriginal=await browser.evaluate(`[...document.querySelectorAll('.epub-original-frame')].map(f=>f.contentDocument.body.textContent)`);
  assert.deepEqual(actualOriginal.map(t=>t.replace(/\s/g,'')),result.original.chapters.map(c=>sourceText(c.html).replace(/\s/g,'')));
  const target=String(result.sections.flatMap(s=>s.sentences).findLastIndex(s=>s.html.includes('diagram-canvas')));
  // This saved workspace has the input and preview expanded. Make reading room,
  // as the user does, before requiring a distant canvas to enter the viewport.
  await browser.evaluate('document.getElementById("readingFocusButton").click()');
  await browser.evaluate('ReadingWorkspace.navigate('+JSON.stringify(target)+')');
  await browser.until(()=>browser.evaluate(`selectedSentence===${JSON.stringify(target)}&&Number(document.querySelector('.sent-card[data-section="${target}"] .diagram-canvas')?.dataset.zoom)>0`));
  await browser.evaluate('workspaceSession.flush()');
  await browser.navigate('http://127.0.0.1:'+server.address().port);
  await browser.until(()=>browser.evaluate('typeof workspaceSession!=="undefined"&&!!workspaceSession&&!busy&&selectedSentence==='+JSON.stringify(target)),15000);
  await browser.evaluate('document.getElementById("readingFocusButton").click()');
  await browser.until(()=>browser.evaluate(`Number(document.querySelector('.sent-card[data-section="${target}"] .diagram-canvas')?.dataset.zoom)>0`));
  const offline=path.join(directory,path.basename(source));
  await fs.writeFile(offline,buildCompleteStudyHtml(result.sections,{original:result.original,filename:path.basename(source)}));
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  await browser.call('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  await browser.navigate(pathToFileURL(offline).href);
  await browser.until(()=>browser.evaluate('!!document.querySelector(".epub-original-frame")?.contentDocument.querySelector(".study-original-sentence")'),15000);
  await browser.evaluate('ReadingWorkspace.navigate('+JSON.stringify(target)+')');
  await browser.until(()=>browser.evaluate(`Number(document.querySelector('.sent-card[data-section="${target}"] .diagram-canvas')?.dataset.zoom)>0`));
  assert.equal(await browser.evaluate('document.querySelectorAll("#rightContent .sent-card").length'),expected);
  assert.deepEqual((await browser.evaluate(`[...document.querySelectorAll('.epub-original-frame')].map(f=>f.contentDocument.body.textContent)`)).map(t=>t.replace(/\s/g,'')),actualOriginal.map(t=>t.replace(/\s/g,'')));
  assert.deepEqual(browser.errors,[]);
  console.log(JSON.stringify({status:'PASS',fullSource:true,sentences:expected,farSentence:target,refreshRestored:true,offline:true,offlineFile:offline}));
 }catch(error){
  if(browser)try{console.log(await browser.evaluate(`({selected:typeof selectedSentence==='undefined'?null:selectedSentence,busy:typeof busy==='undefined'?null:busy,status:document.querySelector('#statusText')?.textContent,rightTop:document.querySelector('#panelRight')?.scrollTop,rightBounds:document.querySelector('#panelRight')?.getBoundingClientRect().toJSON(),tail:[...document.querySelectorAll('.diagram-canvas')].slice(-2).map(c=>({zoom:c.dataset.zoom,bounds:c.getBoundingClientRect().toJSON(),width:c.querySelector('img').naturalWidth,complete:c.querySelector('img').complete})),initialized:document.querySelectorAll('.diagram-canvas[data-zoom]').length})`));}catch{}
  console.log(JSON.stringify({status:'FAIL',stages:stages.map(s=>s.stage)}));throw error;
 }
 finally{await browser?.close();if(server.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}app.locals.closeVocabulary();}
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
