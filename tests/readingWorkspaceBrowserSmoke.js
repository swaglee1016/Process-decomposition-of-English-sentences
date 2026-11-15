const assert=require('node:assert/strict');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');const {pathToFileURL}=require('node:url');
const {createApp}=require('../server');const {openBrowser}=require('./browserHarness');
async function main(){
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'reading-workspace-')),outputDir=path.resolve(__dirname,'../outputs');
 const app=createApp({outputDir,vocabularyPath:path.join(temp,'vocabulary.sqlite'),delayMs:0,analyzeSentence:async text=>({sentenceType:'简单句',translation:'译文：'+text,parts:[{text,role:'主句',translation:'译文'}]}),renderDiagram:async()=>({buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1000"><text x="20" y="40">Synthetic diagram</text></svg>'),mimeType:'image/svg+xml'})});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let browser;
 async function stop(){if(server.listening){server.closeAllConnections();await new Promise(r=>server.close(r));}app.locals.closeVocabulary();}
 try{
  browser=await openBrowser();const {evaluate,until}=browser;await browser.navigate('http://127.0.0.1:'+server.address().port);await until(()=>evaluate('typeof renderSections==="function"'));
  await evaluate('paragraphMode.value="preserve";textInput.value="Rain fell. She waited.";processBtn.click()');await until(()=>evaluate('preview && !busy'));
  await evaluate(`chapterOriginal={chapters:[{title:'Novel',html:'<p>Rain fell. She <em>waited</em>.</p>',styles:[]}]};analyzeBtn.click()`);await until(()=>evaluate('!busy && statusText.textContent.startsWith("完成：")'));
  const filename=await evaluate('savePath.textContent.replace("已永久保存：outputs/","")'),saved=path.join(outputDir,filename);
  async function verify(){
   await until(()=>evaluate('document.querySelector(".epub-original-frame")?.contentDocument.querySelector(".study-original-sentence")'));
   assert.equal(await evaluate('document.getElementById("leftContent").hidden'),true);
   assert.equal(await evaluate('document.querySelectorAll("#translationContent .translation-text").length'),2);
   assert.equal(await evaluate('document.querySelectorAll("#translationContent .translation-item").length'),1,'two sentences in one source paragraph must share one translated paragraph');
   assert.equal(await evaluate('document.querySelectorAll("#translationContent small").length'),0);
   assert.equal(await evaluate('getComputedStyle(document.querySelector("#translationContent .translation-text")).display'),'inline');
   assert.equal(await evaluate('document.getElementById("readingModeToggle").hidden'),true);
   assert.equal(await evaluate('document.querySelectorAll(".column-resizer").length'),2);
   const beforeWidth=await evaluate('document.querySelector(".panel-left").getBoundingClientRect().width');
   const grip=await evaluate('(()=>{const r=document.querySelector(".column-resizer").getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+120};})()');
   await browser.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...grip});await browser.call('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,x:grip.x+65,y:grip.y});await browser.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:grip.x+65,y:grip.y});
   assert.ok(await evaluate('document.querySelector(".panel-left").getBoundingClientRect().width')>beforeWidth+35);
   await evaluate('document.getElementById("readingFocusButton").click()');assert.equal(await evaluate('getComputedStyle(document.querySelector("footer.toolbar")||document.querySelector(".page-header")).display'),'none');assert.equal(await evaluate('document.getElementById("readingFocusButton").textContent'),'恢复工具栏');
   await evaluate('document.getElementById("readingFocusButton").click()');
   await evaluate('document.querySelector("#translationContent [data-section=\\"1\\"]").click()');
   assert.equal(await evaluate('document.querySelector(".epub-original-frame").contentDocument.querySelector(".study-selected").dataset.section'),'1');
   const point=await evaluate('(()=>{const button=document.getElementById("dualScreenButton");button.scrollIntoView({block:"nearest"});const r=button.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()');
   await browser.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await browser.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});await until(()=>evaluate('!!ReadingWorkspace.getDiagramWindow()?.document.getElementById("largeDiagram")'));
   assert.equal(await evaluate('ReadingWorkspace.getDiagramWindow().document.getElementById("largeSentence").textContent'),'She waited.');
   assert.equal(await evaluate('document.querySelector(".dual-panel").classList.contains("separate-diagram")'),true);
   await evaluate('ReadingWorkspace.getDiagramWindow().document.getElementById("previousSentence").click()');
   await until(()=>evaluate('document.querySelector("#translationContent .highlight")?.dataset.section==="0"'));
   await evaluate('document.querySelector("#translationContent [data-section=\\"1\\"]").click()');
   assert.equal(await evaluate('ReadingWorkspace.getDiagramWindow().document.getElementById("largeSentence").textContent'),'She waited.');
   await evaluate('ReadingWorkspace.getDiagramWindow().close()');await until(()=>evaluate('!document.querySelector(".dual-panel").classList.contains("separate-diagram")'));
  }
  await verify();await stop();const before=browser.requests.length;await browser.navigate(pathToFileURL(saved).href);await verify();assert.equal(browser.requests.slice(before).some(url=>/^https?:/.test(url)),false);assert.deepEqual(browser.errors,[]);
  console.log('Reading workspace acceptance passed: EPUB default original, translation alignment, two windows, bidirectional navigation, close restoration, offline.');
 }finally{await browser?.close();await stop();}
}main().catch(error=>{console.error(error);process.exitCode=1;});
