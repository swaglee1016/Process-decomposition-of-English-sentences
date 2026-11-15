const test=require('node:test');const assert=require('node:assert/strict');
const entry={word:'rain',americanPhonetic:'/reɪn/',meanings:[{partOfSpeech:'noun',definitions:[{definition:'Water falling from clouds.',example:'Rain fell.'}]},{partOfSpeech:'verb',definitions:[{definition:'To fall as rain.'}]}]};
test('lookup requests JSON mode and preserves different American pronunciations by part of speech',async()=>{
 const {lookupWord}=require('../services/dictionaryService');const result=await lookupWord('record',{callModel:async(system,user,...args)=>{assert.deepEqual(args[3],{json:true});return JSON.stringify({word:'record',meanings:[{partOfSpeech:'noun',americanPhonetic:'/ˈrɛkɚd/',definitions:[{definition:'Stored information.'}]},{partOfSpeech:'verb',americanPhonetic:'/rɪˈkɔrd/',definitions:[{definition:'To store information.'}]}]});}});
 assert.equal(result.dictionary.pronunciationVersion,1);assert.deepEqual(result.dictionary.meanings.map(m=>m.americanPhonetic),['/ˈrɛkɚd/','/rɪˈkɔrd/']);
});
test('related short phrases are retained safely rather than rejecting the entire explanation',async()=>{
 const {lookupWord}=require('../services/dictionaryService');const result=await lookupWord('rain',{callModel:async()=>JSON.stringify({...entry,relations:{synonyms:[{word:'heavy rain',explanation:'A large amount of rain.'}],antonyms:[],relatedWords:[]}})});
 assert.equal(result.dictionary.relations.synonyms[0].word,'heavy rain');
});
test('word explanations use the existing DeepSeek client and require American IPA',async()=>{
 const {lookupWord}=require('../services/dictionaryService');let calls=0;
 const result=await lookupWord('RAIN',{callModel:async(system,user,...args)=>{calls++;assert.match(system,/American English/);assert.match(system,/IPA/);assert.deepEqual(JSON.parse(user),{word:'rain'});assert.equal(args[1],45000);assert.equal(args[2],0);return JSON.stringify({...entry,inflections:['rain','rains','rained','raining']});}});
 assert.equal(calls,1);assert.equal(result.dictionary.provider,'deepseek');assert.equal(result.dictionary.dialect,'en-US');assert.deepEqual(result.dictionary.meanings.map(m=>m.partOfSpeech),['noun','verb']);assert.equal(result.dictionary.phonetics[0].text,'/reɪn/');assert.equal(result.audioDataUri,null);
 assert.deepEqual(result.dictionary.inflections,['rain','rains','rained','raining']);
});
test('related vocabulary is returned as three separate bounded groups, not as inflections',async()=>{
 const {lookupWord}=require('../services/dictionaryService');
 const relations={synonyms:[{word:'precipitation',explanation:'Water falling from the atmosphere.'}],antonyms:[{word:'drought',explanation:'A prolonged absence of rain.'}],relatedWords:[{word:'rainy',relationship:'rain + suffix -y',explanation:'Having much rain.'}]};
 const result=await lookupWord('rain',{callModel:async(system)=>{assert.match(system,/antonyms/);assert.match(system,/relationship/);return JSON.stringify({...entry,relations});}});
 assert.deepEqual(result.dictionary.relations,relations);assert.equal(result.dictionary.relationsVersion,1);assert.equal(result.dictionary.inflections.includes('rainy'),false);
});
test('invalid or excessive related terms are rejected without rendering arbitrary content',async()=>{
 const {lookupWord}=require('../services/dictionaryService');
 for(const relations of [{synonyms:[{word:'<script>',explanation:'bad'}]},{antonyms:Array.from({length:13},()=>({word:'dry',explanation:'Not wet.'}))},{relatedWords:[{word:'rainy',relationship:'x'.repeat(501),explanation:'Having rain.'}]}]){
  await assert.rejects(()=>lookupWord('rain',{callModel:async()=>JSON.stringify({...entry,relations})}),/单词|相关|释义/);
 }
});
test('DeepSeek word responses reject invalid JSON, mismatched words, missing US IPA and excessive definitions',async()=>{
 const {lookupWord}=require('../services/dictionaryService');
 for(const invalid of ['not JSON',JSON.stringify({...entry,word:'wrong'}),JSON.stringify({...entry,americanPhonetic:''}),JSON.stringify({...entry,meanings:[{partOfSpeech:'noun',definitions:[{definition:'中文'}]}]}),'x'.repeat(512*1024+1)]){
  await assert.rejects(()=>lookupWord('rain',{callModel:async()=>invalid}),/DeepSeek|释义|音标/);
 }
 const result=await lookupWord('rain',{callModel:async()=> '```json\n'+JSON.stringify(entry)+'\n```'});assert.equal(result.dictionary.word,'rain');
 await assert.rejects(()=>lookupWord('two words',{callModel:async()=>{throw new Error('must not call');}}),/单词/);
});
