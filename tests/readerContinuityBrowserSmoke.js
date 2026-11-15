const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {createApp}=require('../server');
const {startApplication}=require('../launcher');
const {makeBook,page,nav}=require('./epubNavigationFixture');
const {openBrowser}=require('./browserHarness');

async function main(){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'reader-continuity-'));
 const book=makeBook({pages:{'first.html':page('<h1>Chapter One</h1><p>First sentence. Second sentence.</p><p>Third sentence.</p>'),
   'last.html':page('<h1>Chapter Two</h1><p>Last words.</p>')},nav:nav([['Chapter One','first.html'],['Chapter Two','last.html']]),
   extra:{'unlisted.html':page('<p>The omitted introduction remains readable.</p>')}});
 const bookPath=path.join(directory,'novel.epub');await fs.writeFile(bookPath,book);
 const secondBookPath=path.join(directory,'second.epub');
 await fs.writeFile(secondBookPath,makeBook({title:'Second Book',
   pages:{'start.html':page('<h1>Another Chapter</h1><p>A different voyage began.</p>')},
   nav:nav([['Another Chapter','start.html']])}));
 const calls=[];let server,app,base,browser,blockOnce=true;
 let releaseSecond,waitingSecond;const second=new Promise(resolve=>waitingSecond=resolve);
 async function launch(port=0){
  app=createApp({outputDir:directory,delayMs:0,directoryModel:async()=>{throw Error('Unexpected paid directory call');},
   analyzeSentence:async text=>{calls.push(text);return {sentenceType:'simple',translation:'Test translation',parts:[{text,role:'main',translation:'Test translation'}]};},
   renderDiagram:async()=>{if(blockOnce&&calls.at(-1)==='First sentence.'){blockOnce=false;waitingSecond();await new Promise(resolve=>releaseSecond=resolve);}
    return {buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="50"><text y="25">Saved</text></svg>'),mimeType:'image/svg+xml'};}});
  server=app.listen(port,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  base='http://127.0.0.1:'+server.address().port;
 }
 async function stop(){if(server?.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));app.locals.closeVocabulary();}}
 try{
  await launch();browser=await openBrowser();const {evaluate,call,until}=browser;
  await call('Network.disable');
  await browser.navigate(base);await until(()=>evaluate('typeof workspaceSession!=="undefined"&&workspaceSession!==null'));
  await evaluate('workspaceSession.initialized');
  const {root}=await call('DOM.getDocument');const {nodeId}=await call('DOM.querySelector',{nodeId:root.nodeId,selector:'#fileInput'});
  await call('DOM.setFileInputFiles',{nodeId,files:[bookPath]});
  await until(()=>evaluate('!!epubBook&&!busy'));
  const firstBookId=await evaluate('epubBook.bookId');
  assert.equal(await evaluate('epubBook.integrity.status'),'verified');
  assert.equal(await evaluate('!![...document.querySelectorAll("#epubMaterialList button")].find(b=>b.textContent.includes("omitted introduction"))'),true);
  await evaluate('selectChapter(epubBook.chapters[0])');await until(()=>evaluate('!!preview&&!busy'));
  await evaluate('editPreview(2,null)');await until(()=>evaluate('!busy'));
  const expected=await evaluate('preview.text');
  await evaluate('workspaceSession.flush()');
  await evaluate('analyzeBtn.click()');await second;
  await until(()=>evaluate('!!analysisJobId'));
  await evaluate('workspaceSession.flush()');
  await browser.navigate(base);releaseSecond();
  await until(()=>evaluate('typeof workspaceSession!=="undefined"&&!!workspaceSession'),20000);await evaluate('workspaceSession.initialized');
  await until(()=>evaluate('!busy&&!!analysisJobId'));
  assert.equal(await evaluate('preview.text'),expected);
  await until(()=>evaluate('!document.querySelector("#resumeAnalysisBtn").disabled'));
  await evaluate('document.querySelector("#resumeAnalysisBtn").click()');
  await until(()=>evaluate('!busy&&!!outputUrl'),20000);
  assert.equal(calls.filter(s=>s==='First sentence.').length,1);
  assert.equal(calls.length,4);
  const filename=await evaluate('outputUrl.split("/").pop()');
  await evaluate(`document.querySelector('#translationContent [data-section="2"]').click()`);
  await evaluate('workspaceSession.flush()');
  const port=server.address().port;
  await evaluate('window.beforeRestart=true');await stop();await launch(port);
  await until(()=>evaluate('typeof epubBook!=="undefined"&&typeof window.beforeRestart==="undefined"&&!!epubBook&&!busy&&!!outputUrl'),25000);
  assert.equal(await evaluate('fileInput.files.length'),0);
  assert.equal(await evaluate('outputUrl.split("/").pop()'),filename);
  assert.equal(await evaluate('selectedSentence'),'2');
  let opened=0;
  const reused=await startApplication({port,presenceGraceMs:0,log:()=>{},openBrowser:async()=>opened++,focusBrowser:async()=>true});
  assert.equal(reused.reused,true);assert.equal(opened,0);
  assert.equal(await evaluate('preview.text'),expected);

  const currentDocument=await call('DOM.getDocument');
  const secondInput=await call('DOM.querySelector',{nodeId:currentDocument.root.nodeId,selector:'#fileInput'});
  await call('DOM.setFileInputFiles',{nodeId:secondInput.nodeId,files:[secondBookPath]});
  await until(()=>evaluate('epubBook?.title==="Second Book"&&!busy'));
  assert.equal(await evaluate('outputUrl'),'');
  const secondBookId=await evaluate('epubBook.bookId');
  await evaluate('selectChapter(epubBook.chapters[0])');await until(()=>evaluate('!!preview&&!busy'));
  const secondPreview=await evaluate('preview.text');
  assert.match(secondPreview,/different voyage/);
  async function selectRecent(id){
    const selector=JSON.stringify('[data-reading-id="'+id+'"]');
    await evaluate('document.querySelector("#recentReading").open=true');
    await until(()=>evaluate('!!document.querySelector('+selector+')&&!document.querySelector('+selector+').disabled'));
    const text=await evaluate('document.querySelector('+selector+').textContent');
    await evaluate('document.querySelector('+selector+').click()');
    await until(()=>evaluate('typeof epubBook!=="undefined"&&!busy&&'+(id==='draft'?'!!textInput.value':'epubBook?.bookId==='+JSON.stringify(id))));
    return text;
  }
  const firstLabel=await selectRecent(firstBookId);
  assert.match(firstLabel,/Chapter One/);assert.match(firstLabel,/第 3 句/);
  assert.equal(await evaluate('outputUrl.split("/").pop()'),filename);
  assert.equal(await evaluate('selectedSentence'),'2');
  await evaluate('textInput.value="The last pasted draft.";textInput.dispatchEvent(new Event("input",{bubbles:true}))');
  await until(()=>evaluate('!busy&&!epubBook'));
  await evaluate('workspaceSession.flush()');
  await selectRecent(secondBookId);
  assert.equal(await evaluate('preview.text'),secondPreview);
  await selectRecent('draft');
  assert.equal(await evaluate('textInput.value'),'The last pasted draft.');
  assert.equal(await evaluate('epubBook'),null);

  const saved=path.join(directory,filename);await stop();
  await call('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  await browser.navigate(pathToFileURL(saved).href);
  await until(()=>evaluate('document.readyState==="complete"&&document.querySelectorAll(".para-text").length>0'));
  assert.match(await evaluate('document.querySelector("#leftContent").textContent'),/First sentence/);
  console.log(JSON.stringify({status:'PASS',bookRestored:true,editedPreviewRestored:true,completedSentencesReused:true,separateBookProgress:true,recentDraft:true,
    sameAddress:true,duplicateBrowserOpens:opened,offline:true,saved}));
 }catch(error){
  if(browser){
   try{console.log(await browser.evaluate('({ready:document.readyState,busy:typeof busy!=="undefined"&&busy,status:document.querySelector("#sessionStatus")?.textContent,message:document.querySelector("#statusText")?.textContent,beforeRestart:window.beforeRestart,book:typeof epubBook!=="undefined"&&epubBook?.bookId,output:typeof outputUrl!=="undefined"&&outputUrl})'));}catch{}
  }
  throw error;
 }finally{releaseSecond?.();await stop();await browser?.close();}
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
