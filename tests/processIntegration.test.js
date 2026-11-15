const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
test('content loss in a paragraph processor is rejected before preview, analysis or saving',async()=>{
  const {createApp}=require('../server');
  const outputDir=await fs.mkdtemp(path.join(os.tmpdir(),'sentence-integrity-'));
  let calls=0;
  const app=createApp({outputDir,prepareParagraphs:async()=>({text:'Only the beginning.',warnings:[]}),analyzeSentence:async()=>{calls++;throw new Error('must not run');}});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port;
  const options={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'Only the beginning. The ending must remain.'})};
  try{
    const response=await fetch(base+'/api/preview',options);assert.equal(response.status,400);assert.match((await response.json()).error,/正文完整性/);
    const events=await fetch(base+'/api/process',options).then(r=>r.text());assert.match(events,/正文完整性/);assert.doesNotMatch(events,/event: complete/);
    assert.equal(calls,0);assert.deepEqual(await fs.readdir(outputDir),[]);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('HTTP PDF preview and direct generation both repair paragraph boundaries inside a single line', async () => {
  const {createApp}=require('../server');
  const {prepareParagraphs}=require('../services/paragraphSplitter');
  const outputDir=await fs.mkdtemp(path.join(os.tmpdir(),'sentence-paragraph-http-'));
  const app=createApp({outputDir,delayMs:0,
    prepareParagraphs:(text,options)=>prepareParagraphs(text,{...options,callModel:async()=>'{"breakAfter":[0]}'}),
    analyzeSentence:async()=>'{"puml":"@startmindmap\\n* Test\\n@endmindmap"}',
    renderDiagram:async()=>({buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><text x="10" y="30">Sentence</text></svg>'),mimeType:'image/svg+xml'})
  });
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const body=JSON.stringify({text:'Mr. Smith left. The next morning Mrs. Jones arrived.',paragraphMode:'pdf'});
  try {
    const preview=await fetch(base+'/api/preview',{method:'POST',headers:{'Content-Type':'application/json'},body}).then(r=>r.json());
    assert.deepEqual(preview.paragraphs,['Mr. Smith left.','The next morning Mrs. Jones arrived.']);
    const events=await fetch(base+'/api/process',{method:'POST',headers:{'Content-Type':'application/json'},body}).then(r=>r.text());
    const complete=events.match(/event: complete\ndata: (.+)/);
    assert.ok(complete,events);
    const result=await fetch(base+'/api/result/'+JSON.parse(complete[1]).resultId).then(r=>r.json());
    assert.deepEqual(result.sections.map(s=>s.paragraph),preview.paragraphs);
    assert.equal((await fetch(base+result.outputUrl)).status,200);
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    const saved=await fs.readFile(path.join(outputDir,result.filename),'utf8');
    assert.equal((saved.match(/class="para-text"/g)||[]).length,2);
    assert.match(saved,/data:image\/svg\+xml;base64/);
  } finally { if(server.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));} }
});
test('HTTP preview, reviewed generation and persisted SVG page work together',async()=>{
  const source=await fs.readFile(path.join(__dirname,'../server.js'),'utf8');
  assert.match(source,/module\.exports\s*=\s*\{\s*createApp/,'server must support app composition without starting a listener');
  const {createApp}=require('../server');
  const outputDir=await fs.mkdtemp(path.join(os.tmpdir(),'sentence-process-http-'));
  const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1000"><text x="30" y="50">Mock diagram</text></svg>');
  const analysed=[];
  const app=createApp({outputDir,delayMs:0,analyzeSentence:async text=>{analysed.push(text);return JSON.stringify({puml:'@startmindmap\n* Sentence\n@endmindmap'});},renderDiagram:async()=>({buffer:svg,mimeType:'image/svg+xml'})});
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const preview=await fetch(base+'/api/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'Mr. Smith left.\n"No."',paragraphMode:'preserve'})}).then(r=>r.json());
    assert.equal(preview.sections.length,2);
    assert.equal(preview.sections[0].sentences[0].text,'Mr. Smith left.');
    const response=await fetch(base+'/api/process',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:preview.text,reviewed:true})});
    const events=await response.text();
    const id=events.match(/event: complete\ndata: (.+)/);
    assert.ok(id,events);
    assert.deepEqual(analysed,['Mr. Smith left.','"No."']);
    const result=await fetch(base+'/api/result/'+JSON.parse(id[1]).resultId).then(r=>r.json());
    assert.match(result.outputUrl,/^\/outputs\//);
    assert.equal((await fetch(base+result.outputUrl)).status,200);
    const imageResponse=await fetch(base+result.sections[0].sentences[0].diagramUrl);
    assert.equal(imageResponse.status,200);
    assert.match(await imageResponse.text(),/适配窗口/);
    assert.equal(await fs.readFile(path.join(outputDir,result.filename),'utf8'),result.html);
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    assert.match(await fs.readFile(path.join(outputDir,result.filename),'utf8'),/Mr\. Smith left\./);
  }finally{if(server.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}}
});
test('multipart limits allow reviewed text above 1 MiB but reject excessive fields',async()=>{
  const {createApp}=require('../server');
  const outputDir=await fs.mkdtemp(path.join(os.tmpdir(),'sentence-large-http-'));
  const app=createApp({outputDir,delayMs:0,analyzeSentence:async()=>'{"puml":"@startmindmap\\n* Test\\n@endmindmap"}',renderDiagram:async()=>null});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const text='word '.repeat(220000)+'end';
    const previewForm=new FormData();previewForm.append('file',new Blob([text],{type:'text/plain'}),'large.txt');previewForm.append('paragraphMode','preserve');
    const previewResponse=await fetch(base+'/api/preview',{method:'POST',body:previewForm});assert.equal(previewResponse.status,200);
    const preview=await previewResponse.json();
    const form=new FormData();form.append('text',preview.text);form.append('reviewed','true');
    const response=await fetch(base+'/api/process',{method:'POST',body:form});
    assert.equal(response.status,200);assert.match(await response.text(),/event: complete/);
    const excess=new FormData();excess.append('text','Hi.');excess.append('paragraphMode','preserve');for(let i=0;i<10;i++)excess.append('extra'+i,'x');
    assert.equal((await fetch(base+'/api/preview',{method:'POST',body:excess})).status,400);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
