const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');
async function start(options={}){
  const {createApp}=require('../server');const outputDir=await fs.mkdtemp(path.join(os.tmpdir(),'vocabulary-http-'));
  const app=createApp({outputDir,delayMs:0,dictionaryLookup:async()=>{throw new Error('offline fixture');},analyzeSentence:async text=>({sentenceType:'简单句',translation:'译文',parts:[{text,role:'主句',translation:'译文'}]}),renderDiagram:async()=>null,...options});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  return {app,server,base:'http://127.0.0.1:'+server.address().port};
}
async function stop({app,server}){server.closeAllConnections();await new Promise(r=>server.close(r));app.locals.closeVocabulary?.();}
test('context explanations cache by word and sentence, deduplicate requests, and persist with generic definitions',async()=>{
 const {VocabularyStore}=require('../services/vocabularyStore');const store=new VocabularyStore(':memory:');store.add({word:'close'});store.updateLookup('close',{dictionary:{word:'close',provider:'deepseek',meanings:[{partOfSpeech:'verb',definitions:[{definition:'To shut.'}]}]}});let calls=0;const state=await start({vocabularyStore:store,contextLookup:async(word,context)=>{calls++;await new Promise(r=>setTimeout(r,20));return {word,context,meaning:context.includes('window')?'To shut the window.':'Near the wall.',partOfSpeech:'verb',role:'The word describes the action or relation in this sentence.'};}});
 try{const {token}=await fetch(state.base+'/api/vocabulary/session',{headers:{'X-Vocabulary-Client':'reader'}}).then(r=>r.json());const call=context=>fetch(state.base+'/api/vocabulary/context',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({word:'close',context})}).then(r=>r.json());
 const result=await Promise.all([call('Close the window.'),call('Close the window.')]);assert.equal(calls,1);assert.equal(result[0].note.meaning,'To shut the window.');await call('Stay close to the wall.');assert.equal(calls,2);await call('Close the window.');assert.equal(calls,2);assert.equal(store.detail('close').dictionary.contextNotes.length,2);assert.equal(store.detail('close').dictionary.meanings[0].definitions[0].definition,'To shut.');
 }finally{await stop(state);}
});
test('old pronunciations are enriched only on explicit request and format failures expose safe actionable messages',async()=>{
 const {VocabularyStore}=require('../services/vocabularyStore');const store=new VocabularyStore(':memory:');store.add({word:'record'});store.updateLookup('record',{dictionary:{word:'record',provider:'deepseek',relationsVersion:1,meanings:[]}});let calls=0;
 const state=await start({vocabularyStore:store,dictionaryLookup:async word=>{calls++;if(word==='broken')throw Object.assign(new Error('private upstream text'),{code:'DICTIONARY_FORMAT_INVALID'});return {dictionary:{word,provider:'deepseek',relationsVersion:1,pronunciationVersion:1,meanings:[]}};}});
 try{const {token}=await fetch(state.base+'/api/vocabulary/session',{headers:{'X-Vocabulary-Client':'reader'}}).then(r=>r.json());const call=body=>fetch(state.base+'/api/vocabulary/explain',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json());
 await call({word:'record'});assert.equal(calls,0);assert.equal((await call({word:'record',includePronunciations:true})).entry.dictionary.pronunciationVersion,1);assert.equal(calls,1);await call({word:'record',includePronunciations:true});assert.equal(calls,1);
 const failed=await call({word:'broken'});assert.match(failed.error,/格式/);assert.doesNotMatch(failed.error,/private/);
 }finally{await stop(state);}
});
test('legacy related groups are updated only on explicit request and cached afterwards',async()=>{
 const {VocabularyStore}=require('../services/vocabularyStore');const store=new VocabularyStore(':memory:');store.add({word:'rain'});store.updateLookup('rain',{dictionary:{word:'rain',provider:'deepseek',meanings:[]}});
 let calls=0;const state=await start({vocabularyStore:store,dictionaryLookup:async word=>{calls++;return {dictionary:{word,provider:'deepseek',relationsVersion:1,relations:{synonyms:[],antonyms:[],relatedWords:[]}},audioDataUri:null};}});
 try{const {token}=await fetch(state.base+'/api/vocabulary/session',{headers:{'X-Vocabulary-Client':'reader'}}).then(r=>r.json());const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
 const call=body=>fetch(state.base+'/api/vocabulary/explain',{method:'POST',headers,body:JSON.stringify(body)}).then(r=>r.json());
 assert.equal((await call({word:'rain'})).entry.dictionary.relationsVersion,undefined);assert.equal(calls,0);
 assert.equal((await call({word:'rain',includeRelations:true})).entry.dictionary.relationsVersion,1);assert.equal(calls,1);
 await call({word:'rain',includeRelations:true});assert.equal(calls,1);assert.equal(store.detail('rain').dictionary.relationsVersion,1);
 }finally{await stop(state);}
});
test('an incomplete supplement cannot replace a valid old cached definition',async()=>{
 const {VocabularyStore}=require('../services/vocabularyStore');const store=new VocabularyStore(':memory:');store.add({word:'rain'});const old={word:'rain',provider:'deepseek',meanings:[{partOfSpeech:'noun',definitions:[{definition:'Existing definition.'}]}]};store.updateLookup('rain',{dictionary:old});const state=await start({vocabularyStore:store,dictionaryLookup:async()=>({dictionary:{word:'rain',provider:'deepseek',meanings:[]}})});
 try{const {token}=await fetch(state.base+'/api/vocabulary/session',{headers:{'X-Vocabulary-Client':'reader'}}).then(r=>r.json());const response=await fetch(state.base+'/api/vocabulary/explain',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({word:'rain',includeRelations:true,includePronunciations:true})});assert.equal(response.status,503);assert.deepEqual(store.detail('rain').dictionary,old);}finally{await stop(state);}
});
test('explanation is on demand, cached and independent of membership; removal clears membership without new model calls',async()=>{
 let calls=0;const state=await start({dictionaryLookup:async word=>{calls++;return {dictionary:{word,provider:'deepseek',dialect:'en-US',phonetics:[{text:'/reɪn/'}],meanings:[{partOfSpeech:'noun',definitions:[{definition:'Water from clouds.'}]}]},audioDataUri:null};}});
 try{const {token}=await fetch(state.base+'/api/vocabulary/session',{headers:{'X-Vocabulary-Client':'reader'}}).then(r=>r.json()),headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
  const request=(route,body)=>fetch(state.base+'/api/vocabulary'+route,{method:'POST',headers,body:JSON.stringify(body||{})}).then(async r=>{assert.equal(r.ok,true);return r.json();});
  const explained=await request('/explain',{word:'rain'});assert.equal(explained.entry.dictionary.provider,'deepseek');await request('/explain',{word:'rain'});assert.equal(calls,1);
  assert.equal((await fetch(state.base+'/api/vocabulary/words',{headers}).then(r=>r.json())).words.length,0);
  await request('/words',{word:'rain'});await request('/words/rain/lookup');assert.equal(calls,1);
  assert.equal((await request('/words/rain/remove')).removed,true);assert.equal((await fetch(state.base+'/api/vocabulary/words',{headers}).then(r=>r.json())).words.length,0);
  await request('/words',{word:'rain'});await request('/words/rain/lookup');assert.equal(calls,1);
 }finally{await stop(state);}
});
test('DeepSeek US pronunciation and English definitions are cached without repeat model calls',async()=>{
 let calls=0;const state=await start({dictionaryLookup:word=>require('../services/dictionaryService').lookupWord(word,{callModel:async()=>{calls++;return JSON.stringify({word,americanPhonetic:'/reɪn/',meanings:[{partOfSpeech:'noun',definitions:[{definition:'Water falling from clouds.'}]}]});}})});
 try{
  const {token}=await fetch(state.base+'/api/vocabulary/session',{headers:{'X-Vocabulary-Client':'reader'}}).then(r=>r.json());const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
  await fetch(state.base+'/api/vocabulary/words',{method:'POST',headers,body:JSON.stringify({word:'rain'})});
  for(let i=0;i<2;i++){const data=await fetch(state.base+'/api/vocabulary/words/rain/lookup',{method:'POST',headers}).then(r=>r.json());assert.equal(data.entry.dictionary.provider,'deepseek');assert.equal(data.entry.dictionary.dialect,'en-US');assert.equal(data.entry.dictionary.phonetics[0].text,'/reɪn/');}
  assert.equal(calls,1);
 }finally{await stop(state);}
});
test('vocabulary requires local origin and a valid capability, including saved file requests',async()=>{
  const state=await start();const {base}=state;
  try{
    assert.equal((await fetch(base+'/api/vocabulary/session',{headers:{Origin:'https://attacker.example','X-Vocabulary-Client':'reader'}})).status,403);
    const session=await fetch(base+'/api/vocabulary/session',{headers:{'X-Vocabulary-Client':'reader'}});
    assert.equal(session.status,200);const {token}=await session.json();
    assert.equal((await fetch(base+'/api/vocabulary/words')).status,401);
    assert.equal((await fetch(base+'/api/vocabulary/words',{headers:{Authorization:'Bearer '+token,Origin:'https://attacker.example'}})).status,403);
    const preflight=await fetch(base+'/api/vocabulary/words',{method:'OPTIONS',headers:{Origin:'null','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'}});
    assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),'null');
    const add=await fetch(base+'/api/vocabulary/words',{method:'POST',headers:{Origin:'null',Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({word:'rain',context:'Rain fell.'})});
    assert.equal(add.status,201);const added=await add.json();assert.equal(added.created,true);
    const lookup=await fetch(base+'/api/vocabulary/words/rain/lookup',{method:'POST',headers:{Authorization:'Bearer '+token}}).then(r=>r.json());
    assert.match(lookup.entry.lookupError,/DeepSeek/);assert.equal(lookup.entry.word,'rain');
    const list=await fetch(base+'/api/vocabulary/words',{headers:{Authorization:'Bearer '+token}}).then(r=>r.json());assert.equal(list.words.length,1);
    const undo=await fetch(base+'/api/vocabulary/undo',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({actionId:added.actionId})}).then(r=>r.json());assert.equal(undo.undone,true);
  }finally{await stop(state);}
});
test('generation, results and exported vocabulary reject foreign Host headers',async()=>{
  const state=await start();
  try{for(const route of ['/api/process','/api/result/anything','/outputs/anything.html']){
    const status=await new Promise((resolve,reject)=>{const request=require('node:http').get(state.base+route,{headers:{Host:'attacker.example:'+state.server.address().port}},response=>{response.resume();resolve(response.statusCode);});request.on('error',reject);});
    assert.equal(status,403);
  }}finally{await stop(state);}
});
test('new study pages retain a vocabulary snapshot and safe dictionary text without a running server',async()=>{
  const state=await start();const {base}=state;
  try{
    const {token}=await fetch(base+'/api/vocabulary/session',{headers:{'X-Vocabulary-Client':'reader'}}).then(r=>r.json());
    await fetch(base+'/api/vocabulary/words',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({word:'rain'})});
    const form=new FormData();form.append('text','Rain fell.');form.append('reviewed','true');
    const events=await fetch(base+'/api/process',{method:'POST',body:form}).then(r=>r.text());const complete=events.match(/event: complete\ndata: (.+)/);assert.ok(complete);
    const result=await fetch(base+'/api/result/'+JSON.parse(complete[1]).resultId).then(r=>r.json());
    assert.equal(result.vocabulary.words[0].word,'rain');assert.match(result.html,/id="vocabularyData"/);assert.match(result.html,/vocabularyButton/);
  }finally{await stop(state);}
});
test('Eudic shortcut endpoint requires capability, validates single words, limits concurrency and hides helper errors',async()=>{
 let calls=0,release;const state=await start({eudicShortcut:async word=>{calls++;if(word==='broken')throw Error('private machine detail');await new Promise(r=>release=r);return{sent:true};}});
 try{const {token}=await fetch(state.base+'/api/vocabulary/session',{headers:{'X-Vocabulary-Client':'reader'}}).then(r=>r.json());const send=(word,auth=token)=>fetch(state.base+'/api/vocabulary/eudic',{method:'POST',headers:{Authorization:'Bearer '+auth,'Content-Type':'application/json'},body:JSON.stringify({word})});assert.equal((await send('rain','bad')).status,401);assert.equal((await send('two words')).status,400);assert.equal(calls,0);const pending=send('rain');while(!release)await new Promise(r=>setTimeout(r,5));assert.equal((await send('window')).status,429);release();assert.deepEqual(await (await pending).json(),{sent:true});assert.equal(calls,1);const failed=await send('broken');assert.equal(failed.status,503);assert.doesNotMatch((await failed.json()).error,/private/);
 }finally{await stop(state);}
});
