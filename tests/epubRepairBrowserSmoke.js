// Browser acceptance with a small synthetic book; --real-model exercises the configured model.
// Analysis and diagrams remain synthetic. Artifacts are retained, never auto-deleted.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {createApp}=require('../server');
const {callDeepSeek}=require('../services/deepseek');
const {makeBook,page,nav}=require('./epubNavigationFixture');
const {openBrowser}=require('./browserHarness');
const {parseEpub}=require('../services/epubParser');
async function main(){
 const outputDir=path.resolve(__dirname,'../outputs');
 const longBook=process.argv.includes('--long-book');
 const filler=longBook?Array.from({length:12},()=>'<p>'+('The sea was calm and Alice watched the boats. '.repeat(2200))+'</p>').join(''):'';
 const body='<h1 id="intro">Introducción</h1><p>This introduction explains how to read the book.</p><h1 id="one">Chapter One</h1><p>Alice walked to the harbour.</p>'+filler+'<h1 id="author">About the Author</h1><p>The author writes short stories.</p>';
 const source=makeBook({title:(process.argv.includes('--real-model')?'Synthetic Structural Repair Acceptance':'Sample Book')+' '+Date.now(),pages:{'book.html':page(body)},nav:nav([['Introducción','book.html#missing']])});
 const normal=makeBook({pages:{'book.html':page(body)},nav:nav([['Introducción','book.html#intro'],['Chapter One','book.html#one'],['About the Author','book.html#author']])});
 let calls=0,sentCharacters=0;
 const app=createApp({outputDir,delayMs:0,directoryModel:async(...args)=>{calls++;sentCharacters+=args[1].length;return process.argv.includes('--real-model')?callDeepSeek(...args):JSON.stringify({sections:JSON.parse(args[1]).paragraphs.filter(p=>p.tag==='h1').map(p=>({start:p.id,title:p.text,depth:0,kind:{'Introducción':'introduction','Chapter One':'chapter','About the Author':'author'}[p.text]}))});},
   analyzeSentence:async text=>({sentenceType:'简单句',translation:'验收译文',parts:[{text,role:'主句',translation:'验收译文'}]}),
   renderDiagram:async()=>({buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><text x="20" y="50">Acceptance diagram</text></svg>'),mimeType:'image/svg+xml'})});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;
 let browser;const stop=async()=>{if(server.listening){server.closeAllConnections();await new Promise(r=>server.close(r));}};
 try{
   browser=await openBrowser();const {evaluate,until}=browser;
   await browser.navigate(base);await until(()=>evaluate('typeof onFileChosen==="function"'));
   async function upload(buffer,name){await evaluate(`(()=>{const file=new File([Uint8Array.from(atob(${JSON.stringify(buffer.toString('base64'))}),c=>c.charCodeAt(0))],${JSON.stringify(name)});const dt=new DataTransfer();dt.items.add(file);fileInput.files=dt.files;onFileChosen();})()`);await until(()=>evaluate('!!epubBook&&!busy'),200000);}
   await upload(normal,'healthy.epub');assert.equal(calls,0);assert.equal(await evaluate('epubBook.chapters.length'),3);
   await upload(source,'repair.epub');
   const state=await evaluate('({navigation:epubBook.navigation,chapters:epubBook.chapters,download:epubBook.aiDirectory.downloadUrl,status:statusText.textContent})');
   assert.equal(state.navigation.status,'ai-generated',state.status);
   assert.deepEqual(state.chapters.map(c=>c.title),['Introducción','Chapter One','About the Author']);
   assert.deepEqual(state.chapters.map(c=>c.kind),['introduction','chapter','author']);
   assert.equal(await evaluate('document.querySelectorAll("#epubCandidates button,#epubMaterialList button").length'),0);
   const geometry=await evaluate('(()=>{const a=epubPanel.getBoundingClientRect(),b=dualPanel.getBoundingClientRect();return {bottom:a.bottom,readerTop:b.top,height:a.height,viewport:innerHeight};})()');
   assert.ok(geometry.height<=geometry.viewport*.45+1);assert.ok(geometry.bottom<=geometry.readerTop);
   const buffer=Buffer.from(await (await fetch(base+state.download)).arrayBuffer());
   assert.equal(parseEpub(buffer).navigation.repaired,true);
   const repairCalls=calls;
   await upload(buffer,'repaired.epub');assert.equal(calls,repairCalls);
   await upload(source,'original-again.epub');assert.equal(calls,repairCalls);
   await evaluate('document.querySelector(".epub-chapter-open").click()');await until(()=>evaluate('!!preview&&!busy'));
   assert.match(await evaluate('preview.sections.map(s=>s.paragraph).join(" ")'),/introduction/i);
   await evaluate('analyzeBtn.click()');await until(()=>evaluate('!busy&&statusText.textContent.startsWith("完成：")'));
   const url=await evaluate('outputUrl');const response=await fetch(base+url);assert.equal(response.status,200);
   const savedPath=path.join(outputDir,decodeURIComponent(url.split('/').at(-1)));
   assert.match(await fs.readFile(savedPath,'utf8'),/This introduction/);
   await stop();await browser.call('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
   await browser.navigate(pathToFileURL(savedPath).href);await until(()=>evaluate('document.body.textContent.includes("This introduction")'));
   assert.deepEqual(browser.errors,[]);
   console.log(JSON.stringify({status:'PASS',realModel:process.argv.includes('--real-model'),longBook,sourceCharacters:body.length,sentCharacters,modelCalls:calls,titles:state.chapters.map(c=>c.title),kinds:state.chapters.map(c=>c.kind),savedPath,repairedEpub:path.join(outputDir,decodeURIComponent(state.download.split('/').at(-1))),serverStopped:!server.listening,checks:['healthy bypass','repair upload','original titles and types','single directory layout','download reimport','cache','chapter selection','analysis and retrieval','offline disk HTML']},null,2));
 }finally{await stop();await browser?.close();}
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
