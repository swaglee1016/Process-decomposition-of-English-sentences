const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {makeBook,page}=require('./epubNavigationFixture');
const {createApp}=require('../server');
const source=()=>makeBook({pages:{'story.html':page('<p>Alpha waited.</p><p>Alpha left.</p><p>Beta returned.</p><p>All ended.</p>')}});
async function setup(callModel){
  const outputDir=await fs.mkdtemp(path.join(os.tmpdir(),'epub-ai-http-'));
  const app=createApp({outputDir,directoryModel:callModel}),server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  return {base,outputDir,stop:async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));}};
}
async function upload(base,buffer=source()){
  const form=new FormData();form.append('file',new Blob([buffer]),'story.epub');
  return fetch(base+'/api/epub/toc',{method:'POST',body:form}).then(r=>r.json());
}
const model=async()=>JSON.stringify({sections:[{start:0},{start:2}]});
test('running repairs expose batch progress without exposing book text',async()=>{
 let release,started;const entered=new Promise(r=>started=r);
 const app=await setup(async()=>{started();await new Promise(r=>release=r);return model();});
 try{
  const toc=await upload(app.base);
  const pending=fetch(app.base+'/api/epub/ai-directory',{method:'POST',headers:{'Content-Type':'application/json','X-Reader-Client':'epub-ai-directory'},body:JSON.stringify({bookId:toc.bookId})});
  await entered;
  const response=await fetch(app.base+'/api/epub/ai-directory/status/'+toc.bookId);assert.equal(response.status,200);
  const progress=await response.json();assert.equal(progress.current,1);assert.equal(progress.total,1);assert.equal(progress.phase,'full');assert.doesNotMatch(JSON.stringify(progress),/Alpha/);
  release();assert.equal((await pending).status,200);
 }finally{release?.();await app.stop();}
});
test('upload tells UI to generate; completion provides real chapters and a persistent EPUB download',async()=>{
  let calls=0;const app=await setup(async()=>{calls++;return model();});
  try {
    const original=source(),toc=await upload(app.base,original);
    assert.equal(toc.aiDirectory.state,'needed');assert.equal(calls,0);
    const response=await fetch(app.base+'/api/epub/ai-directory',{method:'POST',headers:{'Content-Type':'application/json','X-Reader-Client':'epub-ai-directory'},body:JSON.stringify({bookId:toc.bookId})});
    assert.equal(response.status,200);const result=await response.json();
    assert.equal(result.navigation.status,'ai-generated');assert.equal(result.chapters.length,2);
    assert.equal(result.aiDirectory.state,'ready');assert.match(result.aiDirectory.downloadUrl,/\.epub$/);
    const downloaded=await fetch(app.base+result.aiDirectory.downloadUrl);
    assert.equal(downloaded.status,200);const buffer=Buffer.from(await downloaded.arrayBuffer());
    const reread=await upload(app.base,buffer);assert.equal(reread.navigation.status,'ai-generated');
    const cached=await upload(app.base,original);assert.equal(cached.navigation.status,'ai-generated');assert.equal(calls,1);
    const chapter=await fetch(app.base+'/api/epub/chapter',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({bookId:result.bookId,id:result.chapters[1].id})}).then(r=>r.json());
    assert.equal(chapter.text,'Beta returned.\nAll ended.');
  }finally{await app.stop();}
});
test('AI endpoint rejects foreign origins before calling a model, and failure preserves reading mode',async()=>{
  let calls=0;const app=await setup(async()=>{calls++;throw new Error('service unavailable');});
  try {
    const toc=await upload(app.base);
    const send=headers=>fetch(app.base+'/api/epub/ai-directory',{method:'POST',headers:{'Content-Type':'application/json','X-Reader-Client':'epub-ai-directory',...headers},body:JSON.stringify({bookId:toc.bookId})});
    assert.equal((await send({Origin:'https://foreign.invalid'})).status,403);assert.equal(calls,0);
    const failed=await send({});assert.equal(failed.status,502);assert.equal(calls,1);
    const readable=await fetch(app.base+'/api/epub/chapter',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({bookId:toc.bookId,mode:'reading'})});
    assert.equal(readable.status,200);
  }finally{await app.stop();}
});

test('upload rejects cross-site requests before parsing or writing migrated files',async()=>{
  const app=await setup(async()=>{throw new Error('must not call model');});
  try{
    for(const headers of [{Origin:'https://foreign.invalid'},{'Sec-Fetch-Site':'cross-site'}]){
      const form=new FormData();form.append('file',new Blob([source()]),'story.epub');
      const response=await fetch(app.base+'/api/epub/toc',{method:'POST',headers,body:form});
      assert.equal(response.status,403);
    }
    assert.deepEqual(await fs.readdir(app.outputDir),[]);
    const local=await upload(app.base);
    assert.equal(local.aiDirectory.state,'needed');
  }finally{await app.stop();}
});
