const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {createApp}=require('../server');
function request(port,route,body){return new Promise((resolve,reject)=>{
  const req=http.request({host:'127.0.0.1',port,path:route,method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{}},res=>{
    let text='';res.setEncoding('utf8');res.on('data',part=>text+=part);res.on('end',()=>resolve({status:res.statusCode,text}));
  });req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
});}
test('default renderer wiring produces an SVG card, without an injected renderer',async(t)=>{
  t.mock.method(global,'fetch',()=>{throw new Error('The local renderer must not use the network');});
  const outputDir=await fs.mkdtemp(path.join(os.tmpdir(),'sentence-default-renderer-'));
  const server=createApp({outputDir,delayMs:0,analyzeSentence:async()=>'{"puml":"@startmindmap\\n* Test\\n@endmindmap"}'}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));const port=server.address().port;
  try{
    const processed=await request(port,'/api/process',{text:'Mr. Smith left.',reviewed:true});
    const event=processed.text.match(/event: complete\ndata: (.+)/);assert.ok(event,processed.text);
    const result=JSON.parse((await request(port,'/api/result/'+JSON.parse(event[1]).resultId)).text);
    assert.match(result.sections[0].sentences[0].html,/data:image\/svg\+xml;base64,/);
    assert.ok(result.sections[0].sentences[0].diagramFilename);
    const saved=await fs.readFile(path.join(outputDir,result.filename),'utf8');
    assert.match(saved,/data:image\/svg\+xml;base64,/);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
