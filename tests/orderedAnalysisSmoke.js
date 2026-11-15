// Manual real-service acceptance using two synthetic sentences only.
// Retains the saved demonstration in outputs; never reads a user's article.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {createApp}=require('../server');
const {analyzeSentence}=require('../services/deepseek');
const {parseAnalysis}=require('../services/orderedAnalysis');

async function main(){
  const examples=[
    'Miss Carter, who had already checked the report twice before the meeting began, said that the team could submit it today.',
    'When the rain finally stopped, the volunteers who had waited by the station carried the boxes inside and opened the doors.'
  ];
  const evidence=[];
  const server=createApp({delayMs:0,analyzeSentence:async sentence=>{
    const raw=await analyzeSentence(sentence);
    const parsed=parseAnalysis(raw,sentence);
    const relative=sentence.indexOf('who'),predicate=sentence.indexOf(sentence.startsWith('Miss')?'said':'carried');
    const relativePart=parsed.ordered.findIndex(p=>p.start<=relative&&p.end>relative);
    const predicatePart=parsed.ordered.findIndex(p=>p.start<=predicate&&p.end>predicate);
    assert.ok(relativePart>=0&&predicatePart>relativePart,'Relative clause must precede the resumed predicate in the actual model analysis');
    evidence.push({parts:parsed.ordered.map(p=>({role:p.role,start:p.start,end:p.end})),relativePart,predicatePart,translation:parsed.translation});
    return raw;
  }}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  let filename;
  try{
    const events=await fetch(base+'/api/process',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:examples.join('\n\n'),reviewed:true}),signal:AbortSignal.timeout(120000)}).then(r=>r.text());
    const complete=events.match(/event: complete\ndata: (.+)/);assert.ok(complete,'Process must complete');
    const result=await fetch(base+'/api/result/'+JSON.parse(complete[1]).resultId).then(r=>r.json());
    assert.equal(evidence.length,2,'Both real model analyses must pass source-order validation');
    assert.equal((result.html.match(/class="diagram-canvas"/g)||[]).length,2,'Both diagrams must render');
    assert.equal((result.html.match(/class="translation-text"/g)||[]).length,2);
    assert.equal(result.sections.flatMap(s=>s.sentences).filter(s=>s.translation).length,2);
    assert.equal((await fetch(base+result.outputUrl)).status,200);
    filename=path.join(__dirname,'../outputs',result.filename);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  const offline=await fs.readFile(filename,'utf8');assert.ok(offline.includes('StudyNavigation'));
  console.log(JSON.stringify({status:'PASS',filename,serverStopped:true,source:'two synthetic sentences only',evidence},null,2));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
