const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createApp}=require('../server');
const {makeBook,page,nav}=require('./epubNavigationFixture');

async function start(outputDir,options={}){
 const app=createApp({outputDir,delayMs:0,analyzeSentence:async text=>({sentenceType:'simple',translation:'Saved.',parts:[{text,role:'main',translation:'Saved.'}]}),renderDiagram:async()=>null,...options});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 return {app,base:'http://127.0.0.1:'+server.address().port,async stop(){server.closeAllConnections();await new Promise(r=>server.close(r));app.locals.closeVocabulary();}};
}
const send=(base,url,body,method='POST',headers={})=>fetch(base+url,{method,headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});

async function uploadReadingBook(base,title){
 const pages={'chapter.html':page('<h1>Chapter One</h1><p>Opening paragraph.</p>')};
 const form=new FormData();
 form.append('file',new Blob([makeBook({title,pages,nav:nav([['Chapter One','chapter.html']])})]),'book.epub');
 const response=await fetch(base+'/api/epub/toc',{method:'POST',body:form});
 assert.equal(response.status,200);
 return (await response.json()).bookId;
}

test('recent reading keeps separate EPUBs and the latest pasted draft after restart',async()=>{
 const outputDir=await fs.mkdtemp(path.join(os.tmpdir(),'reader-recent-'));
 let run=await start(outputDir);
 const recent='/api/recent-reading';
 const read=async endpoint=>{
  const response=await fetch(run.base+endpoint);
  assert.equal(response.status,200);
  return response.json();
 };
 try{
  const firstId=await uploadReadingBook(run.base,'First Book');
  const secondId=await uploadReadingBook(run.base,'Second Book');
  const newId=await uploadReadingBook(run.base,'Never Opened Book');
  const {items:sourceItems}=await read(recent);
  assert.deepEqual(sourceItems.map(item=>item.title).sort(),['First Book','Never Opened Book','Second Book']);
  assert.ok(sourceItems.every(item=>item.type==='book'&&!item.hasProgress&&!item.current));
  assert.deepEqual(await read(recent+'/'+newId),{state:{schema:1,bookId:newId},hasProgress:false});

  const first={schema:1,bookId:firstId,selectedSentence:'3',preview:{text:'First private preview.'},
   readingLabel:{title:'First Book',chapter:'Introduction'},
   resultFilename:'sentence-decomposition-20261107-123001.html',
   jobId:'00000000-0000-4000-8000-000000000001'};
  // Exercise an old workspace created before readingLabel existed.
  const second={schema:1,bookId:secondId,selectedSentence:'8',preview:{text:'Second private preview.'},
   jobId:'00000000-0000-4000-8000-000000000002'};
  const draft={schema:1,input:{text:'Private pasted article.',paragraphMode:'pdf'},preview:{text:'Private pasted article.'}};
  for(const [revision,state] of [first,second,draft].entries()){
   assert.equal((await send(run.base,'/api/workspace',{state,revision},'PUT')).status,200);
  }
  await run.stop();
  run=await start(outputDir);

  const {items}=await read(recent);
  assert.deepEqual(items[0],{id:'draft',type:'draft',title:'最近粘贴的文章',chapter:'',sentence:null,hasProgress:true,current:true});
  const byId=new Map(items.map(item=>[item.id,item]));
  assert.equal(byId.get(firstId).chapter,'Introduction');
  assert.equal(byId.get(firstId).sentence,4);
  assert.equal(byId.get(secondId).sentence,9);
  assert.equal(byId.get(secondId).title,'Second Book');
  assert.equal(byId.get(secondId).chapter,'');
  assert.equal(byId.get(newId).hasProgress,false);
  assert.doesNotMatch(JSON.stringify(items),/Private|private|resultFilename|jobId/);
  for(const [id,state] of [[firstId,first],[secondId,second],['draft',draft]]){
   assert.deepEqual(await read(recent+'/'+id),{state,hasProgress:true});
  }

  assert.equal((await send(run.base,'/api/workspace',{state:first,revision:3},'PUT')).status,200);
  assert.equal((await send(run.base,'/api/workspace',{state:second,revision:3},'PUT')).status,409);
  assert.deepEqual((await read('/api/workspace')).state,first);
  assert.deepEqual((await read(recent+'/draft')).state,draft);
  assert.deepEqual((await read(recent+'/'+secondId)).state,second);
  assert.equal((await fetch(run.base+recent,{headers:{Origin:'https://other.invalid'}})).status,403);
  assert.equal((await fetch(run.base+recent+'/..%2foutside')).status,400);
  assert.equal((await fetch(run.base+recent+'/'+'0'.repeat(64))).status,404);
 }finally{await run.stop();}
});

test('a failed history write preserves the previous workspace and revision',async()=>{
 const outputDir=await fs.mkdtemp(path.join(os.tmpdir(),'reader-recent-unwritable-'));
 const sessionDir=outputDir+'-reader-session';
 const run=await start(outputDir,{sessionDir});
 try{
  const blank={schema:1,input:{text:'   ',paragraphMode:'preserve'}};
  assert.equal((await send(run.base,'/api/workspace',{state:blank,revision:0},'PUT')).status,200);
  const draft={schema:1,input:{text:'Draft that must survive.',paragraphMode:'preserve'}};
  assert.equal((await send(run.base,'/api/workspace',{state:draft,revision:1},'PUT')).status,200);
  // Block only the historical record, leaving the original workspace writable.
  await fs.mkdir(path.join(sessionDir,'reading-history','draft.json'),{recursive:true});
  const invalid={...draft,readingLabel:{title:'x'.repeat(257),chapter:''}};
  assert.equal((await send(run.base,'/api/workspace',{state:invalid,revision:2},'PUT')).status,400);
  assert.equal((await send(run.base,'/api/workspace',{state:blank,revision:2},'PUT')).status,500);
  assert.deepEqual(await (await fetch(run.base+'/api/workspace')).json(),{state:draft,revision:2});
  assert.deepEqual(await (await fetch(run.base+'/api/recent-reading/draft')).json(),{state:draft,hasProgress:true});
 }finally{await run.stop();}
});

test('uploaded source, workspace CAS and saved result recover after a new application instance',async()=>{
 const outputDir=await fs.mkdtemp(path.join(os.tmpdir(),'reader-state-'));
 let run=await start(outputDir);let id,filename;
 try{
  const form=new FormData();form.append('file',new Blob([makeBook({pages:{'one.html':page('<h1>Chapter One</h1><p>Opening.</p>')},nav:nav([['Chapter One','one.html']])})]),'book.epub');
  const toc=await (await fetch(run.base+'/api/epub/toc',{method:'POST',body:form})).json();id=toc.bookId;
  assert.match(id,/^[a-f0-9]{64}$/);
  const state={schema:1,bookId:id,selection:{ids:['0'],activeId:'0',mode:'chapter',loadedIds:['0']},input:{text:'',paragraphMode:'preserve'},preview:{text:'Opening.',sections:[{paragraph:'Opening.',sentences:[{text:'Opening.',start:0,end:8}]}]},selectedSentence:'0'};
  const saved=await send(run.base,'/api/workspace',{state,revision:0},'PUT');assert.equal(saved.status,200);
  const conflict=await send(run.base,'/api/workspace',{state,revision:0},'PUT');assert.equal(conflict.status,409);
  const events=await (await send(run.base,'/api/process',{text:'Opening.',reviewed:true})).text();
  const done=JSON.parse(events.match(/event: complete\ndata: (.+)/)[1]);filename=done.filename;
  assert.ok(filename);await run.stop();run=await start(outputDir);
  const restored=await (await fetch(run.base+'/api/workspace')).json();assert.deepEqual(restored.state,state);assert.equal(restored.revision,1);
  const tocAgain=await fetch(run.base+'/api/epub/book/'+id);assert.equal(tocAgain.status,200);
  const chapter=await (await send(run.base,'/api/epub/chapter',{bookId:id,id:'0'})).json();assert.match(chapter.text,/Opening/);
  const result=await fetch(run.base+'/api/saved-result/'+filename);assert.equal(result.status,200);assert.equal((await result.json()).sections[0].sentences[0].text,'Opening.');
  assert.equal((await send(run.base,'/api/workspace',{state,revision:1},'PUT',{Origin:'https://other.invalid'})).status,403);
  assert.equal((await fetch(run.base+'/api/jobs/not-a-job')).status,400);
 }finally{await run.stop();}
});

test('interrupted analysis reuses completed sentences and an in-flight analysis checkpoint',async()=>{
 const outputDir=await fs.mkdtemp(path.join(os.tmpdir(),'reader-job-'));
 let release,entered;const waiting=new Promise(r=>entered=r);let calls=[];
 let run=await start(outputDir,{analyzeSentence:async text=>{calls.push(text);return {sentenceType:'simple',translation:'Saved.',parts:[{text,role:'main',translation:'Saved.'}]};},renderDiagram:async()=>{if(calls.length===2){entered();await new Promise(r=>release=r);}return null;}});
 const controller=new AbortController();let jobId;
 try{
  const response=await fetch(run.base+'/api/process',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'First. Second. Third.',reviewed:true})});
  const reader=response.body.getReader();let buffer='';while(!jobId){buffer+=new TextDecoder().decode((await reader.read()).value);const match=buffer.match(/event: job\ndata: (.+)/);if(match)jobId=JSON.parse(match[1]).jobId;}
  await waiting;
  const checkpoint=JSON.parse(await fs.readFile(path.join(outputDir+'-reader-session','jobs',jobId,'sentences','1.json'),'utf8'));
  assert.equal(checkpoint.completed,false);assert.ok(checkpoint.analysis.code);
  const duplicate=await send(run.base,'/api/process',{jobId,reviewed:true});assert.equal(duplicate.status,409);
  controller.abort();release();await new Promise(r=>setTimeout(r,40));await run.stop();
  run=await start(outputDir,{analyzeSentence:async text=>{calls.push(text);return {sentenceType:'simple',translation:'Saved.',parts:[{text,role:'main',translation:'Saved.'}]};}});
  const before=await (await fetch(run.base+'/api/jobs/'+jobId)).json();assert.ok(before.completed>=1);
  const events=await (await send(run.base,'/api/process',{jobId,reviewed:true})).text();assert.match(events,/event: complete/);
  assert.deepEqual(calls,['First.','Second.','Third.']);
  const completed=await (await fetch(run.base+'/api/jobs/'+jobId)).json();assert.equal(completed.completed,3);assert.equal(completed.status,'complete');
  const again=await (await send(run.base,'/api/process',{jobId,reviewed:true})).text();assert.match(again,/event: complete/);assert.equal(calls.length,3);
 }finally{release?.();await run.stop();}
});

test('workspace rejects unsafe fields and concurrent stale writers, and reports disk-save failure',async()=>{
 const outputDir=await fs.mkdtemp(path.join(os.tmpdir(),'reader-state-validation-'));
 const run=await start(outputDir);
 try{
  const state={schema:1,input:{text:'Unchanged.',paragraphMode:'preserve'},preview:{text:'Unchanged.',warnings:[]},selection:{ids:null,loadedIds:null,activeId:null,mode:'chapter'}};
  for(const change of [{bookId:'../../escape'},{resultFilename:'../outside.html'},{jobId:'bad'},{preview:{text:'Text',sections:'bad'}},{layout:{columnWidth:'invalid'}},{selectedSentence:'<script>'}]){
   assert.equal((await send(run.base,'/api/workspace',{state:{...state,...change},revision:0},'PUT')).status,400);
  }
  const responses=await Promise.all([0,1].map(()=>send(run.base,'/api/workspace',{state,revision:0},'PUT')));
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  const pollution=await fetch(run.base+'/api/workspace',{method:'PUT',headers:{'Content-Type':'application/json'},body:'{"state":{"schema":1,"input":{"text":"x","paragraphMode":"preserve","__proto__":{}}},"revision":1}'});
  assert.equal(pollution.status,400);
  assert.equal((await fetch(run.base+'/api/saved-result/not-a-result.html')).status,400);
  assert.equal((await send(run.base,'/api/workspace',{state,revision:1},'PUT',{'Sec-Fetch-Site':'cross-site'})).status,403);
 }finally{await run.stop();}
 const blocked=await fs.mkdtemp(path.join(os.tmpdir(),'reader-state-unwritable-'));
 const sessionDir=path.join(blocked,'state');await fs.mkdir(path.join(sessionDir,'workspace.json'),{recursive:true});
 const failed=await start(blocked,{sessionDir});
 try{const response=await send(failed.base,'/api/workspace',{state:{schema:1},revision:0},'PUT');assert.equal(response.status,500);assert.ok((await fs.stat(path.join(sessionDir,'workspace.json'))).isDirectory());}
 finally{await failed.stop();}
});

test('saved diagrams and legacy study pages can be restored without rerunning analysis',async()=>{
 const outputDir=await fs.mkdtemp(path.join(os.tmpdir(),'reader-legacy-'));
 let calls=0;const run=await start(outputDir,{analyzeSentence:async text=>{calls++;return {sentenceType:'simple',translation:'Saved.',parts:[{text,role:'main',translation:'Saved.'}]};},renderDiagram:async()=>({buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><text y="15">Test</text></svg>'),mimeType:'image/svg+xml'})});
 try{
  const events=await (await send(run.base,'/api/process',{text:'One sentence.',reviewed:true})).text();const done=JSON.parse(events.match(/event: complete\ndata: (.+)/)[1]);
  const result=await (await fetch(run.base+'/api/saved-result/'+done.filename)).json();assert.match(result.sections[0].sentences[0].html,/data:image\/svg\+xml;base64/);
  const compact=await (await fetch(run.base+'/api/saved-result/'+done.filename+'?view=reader')).json();
  assert.equal(Object.hasOwn(compact,'html'),false,'Reader restoration should not transfer another full copy of the saved HTML');
  assert.deepEqual(compact.sections,result.sections);assert.deepEqual(compact.original,result.original);
  const legacy='sentence-decomposition-20000101-000000.html';await fs.writeFile(path.join(outputDir,legacy),result.html.replace(/<script type="application\/json" id="readerResultData">[\s\S]*?<\/script>/,''));
  const restored=await (await fetch(run.base+'/api/saved-result/'+legacy)).json();assert.equal(restored.sections[0].paragraph,'One sentence.');assert.match(restored.sections[0].sentences[0].html,/data:image\/svg\+xml;base64/);assert.equal(calls,1);
 }finally{await run.stop();}
});

test('an unwritable checkpoint store prevents analysis and completion announcements',async()=>{
 const outputDir=await fs.mkdtemp(path.join(os.tmpdir(),'reader-checkpoint-failure-'));
 const sessionDir=path.join(outputDir,'state');await fs.writeFile(sessionDir,'occupied');let calls=0;
 const run=await start(outputDir,{sessionDir,analyzeSentence:async()=>{calls++;throw Error('must not call');}});
 try{const events=await (await send(run.base,'/api/process',{text:'Keep every word.',reviewed:true})).text();assert.match(events,/event: error/);assert.doesNotMatch(events,/event: complete/);assert.equal(calls,0);}
 finally{await run.stop();}
});

test('initial paragraph processing is busy until it completes or fails',async()=>{
 const outputDir=await fs.mkdtemp(path.join(os.tmpdir(),'reader-busy-'));
 let release,entered;const waiting=new Promise(r=>entered=r);
 const run=await start(outputDir,{prepareParagraphs:async()=>{entered();await new Promise(r=>release=r);throw Error('Preparation failed');}});
 try{
  const pending=send(run.base,'/api/process',{text:'Keep every word.'});await waiting;
  assert.equal(run.app.locals.analysisActive,1);release();
  assert.match(await (await pending).text(),/event: error/);assert.equal(run.app.locals.analysisActive,0);
 }finally{release?.();await run.stop();}
});

test('accepted restart blocks new previews, analysis and AI directory calls',async()=>{
 const outputDir=await fs.mkdtemp(path.join(os.tmpdir(),'reader-restart-gate-'));let calls=0;
 const run=await start(outputDir,{prepareParagraphs:async()=>{calls++;throw Error('must not run');},analyzeSentence:async()=>{calls++;throw Error('must not run');},directoryModel:async()=>{calls++;throw Error('must not run');}});
 try{
  run.app.locals.readerRestarting=true;
  for(const endpoint of ['/api/preview','/api/process','/api/epub/ai-directory']){
   const response=await send(run.base,endpoint,{text:'Keep all words.',reviewed:true},'POST',{'X-Reader-Client':'epub-ai-directory'});
   assert.equal(response.status,503);assert.match((await response.json()).error,/正在更新/);
  }
  assert.equal(calls,0);assert.equal(run.app.locals.analysisActive,0);
  assert.equal((await send(run.base,'/api/workspace',{state:{schema:1},revision:0},'PUT')).status,503);
  assert.equal((await send(run.base,'/api/epub/toc',{})).status,503);
 }finally{await run.stop();}
});

test('preview and AI directory model calls count as active while awaiting a model',async()=>{
 const outputDir=await fs.mkdtemp(path.join(os.tmpdir(),'reader-model-busy-'));
 let releasePreview,previewEntered,releaseDirectory,directoryEntered;
 const previewWaiting=new Promise(r=>previewEntered=r),directoryWaiting=new Promise(r=>directoryEntered=r);
 const run=await start(outputDir,{
  prepareParagraphs:async text=>{previewEntered();await new Promise(r=>releasePreview=r);return {text,warnings:[]};},
  directoryModel:async()=>{directoryEntered();await new Promise(r=>releaseDirectory=r);throw Error('Synthetic model unavailable');}
 });
 try{
  const pendingPreview=send(run.base,'/api/preview',{text:'Preserve all words.'});await previewWaiting;
  assert.equal(run.app.locals.analysisActive,1);releasePreview();assert.equal((await pendingPreview).status,200);assert.equal(run.app.locals.analysisActive,0);
  const form=new FormData();form.append('file',new Blob([makeBook({pages:{'story.html':page('<p>Opening.</p><p>Ending.</p>')}})]),'directory.epub');
  const book=await (await fetch(run.base+'/api/epub/toc',{method:'POST',body:form})).json();
  const pendingDirectory=send(run.base,'/api/epub/ai-directory',{bookId:book.bookId},'POST',{'X-Reader-Client':'epub-ai-directory'});await directoryWaiting;
  assert.equal(run.app.locals.analysisActive,1);releaseDirectory();assert.equal((await pendingDirectory).status,502);assert.equal(run.app.locals.analysisActive,0);
 }finally{releasePreview?.();releaseDirectory?.();await run.stop();}
});
