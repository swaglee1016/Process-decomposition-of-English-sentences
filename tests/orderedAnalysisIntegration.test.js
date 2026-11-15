const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createApp}=require('../server');
test('HTTP analysis repairs a mismatched result once before rendering and saves the repaired translation',async()=>{
 const outputDir=await fs.mkdtemp(path.join(os.tmpdir(),'analysis-repair-http-'));let calls=0,draws=0;const app=createApp({outputDir,delayMs:0,analyzeSentence:async(text,options)=>{calls++;if(calls===2)assert.equal(options.repair,true);return {sentenceType:'简单句',translation:'她等着。',parts:[{text:calls===1?'She left.':text,role:'主句',translation:'她等着。'}]};},renderDiagram:async()=>{draws++;return {buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"></svg>'),mimeType:'image/svg+xml'};}});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 try{const events=await fetch(base+'/api/process',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'She waited.',reviewed:true})}).then(r=>r.text());assert.match(events,/correcting/);const id=JSON.parse(events.match(/event: complete\ndata: (.+)/)[1]).resultId;const result=await fetch(base+'/api/result/'+id).then(r=>r.json());assert.equal(calls,2);assert.equal(draws,1);assert.equal(result.sections[0].sentences[0].translation,'她等着。');assert.doesNotMatch(result.html,/自动校正后仍未通过/);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));app.locals.closeVocabulary();}
});

test('generation preserves structured translations and sends source-ordered grammar to renderer',async()=>{
  const outputDir=await fs.mkdtemp(path.join(os.tmpdir(),'ordered-analysis-http-'));
  let rendered='';
  const source='The book that I bought arrived.';
  const response={sentenceType:'复合句',translation:'我买的书到了。',parts:[
    {text:'arrived.',role:'主句后段',translation:'到了'},
    {text:'The book',role:'主语',translation:'那本书'},
    {text:'that I bought',role:'定语从句',translation:'我买的'}
  ]};
  const server=createApp({outputDir,delayMs:0,analyzeSentence:async()=>JSON.stringify(response),renderDiagram:async code=>{
    rendered=code;return {buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"></svg>'),mimeType:'image/svg+xml'};
  }}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  let saved;
  try {
    const events=await fetch(base+'/api/process',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:source,reviewed:true})}).then(r=>r.text());
    const complete=events.match(/event: complete\ndata: (.+)/);assert.ok(complete);
    const result=await fetch(base+'/api/result/'+JSON.parse(complete[1]).resultId).then(r=>r.json());
    assert.equal(result.sections[0].sentences[0].translation,response.translation);
    assert.ok(rendered.indexOf('** 1.')<rendered.indexOf('** 2.'));
    assert.match(rendered,/\*\* 2\. 定语从句/);
    assert.match(result.html,/class="translation-text"[^>]*>我买的书到了。/);
    assert.equal((await fetch(base+result.outputUrl)).status,200);
    saved=path.join(outputDir,result.filename);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  assert.match(await fs.readFile(saved,'utf8'),/我买的书到了。/);
});
