const test=require('node:test');const assert=require('node:assert/strict');
test('word highlighting matches whole words and preserves source text, casing and apostrophes',()=>{
  const {wordRuns,normalizeWord}=require('../public/vocabularyShared');
  const text="Fell, fellow, FELL. Don't re-enter.";
  const runs=wordRuns(text,['fell',"don't",'re-enter']);
  assert.equal(runs.map(run=>run.text).join(''),text);
  assert.deepEqual(runs.filter(run=>run.word).map(run=>run.text),['Fell','FELL',"Don't",'re-enter']);
  assert.equal(normalizeWord('Don’t'),"don't");assert.throws(()=>normalizeWord('two words'),/单词/);
});
test('known noun plurals and verb forms share one vocabulary entry without matching unrelated words',()=>{
 const {wordRuns,findVocabularyWord}=require('../public/vocabularyShared');
 const entries=[{word:'incantation',dictionary:{meanings:[{partOfSpeech:'noun'}]}},{word:'run',dictionary:{meanings:[{partOfSpeech:'verb'}]}},{word:'study',dictionary:{meanings:[{partOfSpeech:'verb'}]}},{word:'happy',dictionary:{meanings:[{partOfSpeech:'adjective'}]}}];
 const text="Incantations incantation's incantational ran running runs studies studied studying happier happiest.";
 const runs=wordRuns(text,entries);assert.equal(runs.map(run=>run.text).join(''),text);
 assert.deepEqual(runs.filter(run=>run.word).map(run=>[run.text,run.word]),[['Incantations','incantation'],["incantation's",'incantation'],['ran','run'],['running','run'],['runs','run'],['studies','study'],['studied','study'],['studying','study'],['happier','happy'],['happiest','happy']]);
 assert.equal(findVocabularyWord('incantations',entries),'incantation');assert.equal(findVocabularyWord('incantational',entries),null);
 assert.equal(findVocabularyWord('running',[...entries,{word:'running'}]),'running','exact collected spelling wins over related forms');
});
test('cached model inflections and explicit lemma explanations cover collected inflected forms',()=>{
 const {findVocabularyWord}=require('../public/vocabularyShared');
 const entry={word:'baffled',dictionary:{meanings:[{partOfSpeech:'verb',definitions:[{definition:'The past tense of baffle.'}]}]}};
 for(const word of ['baffle','baffling','baffles','baffled'])assert.equal(findVocabularyWord(word,[entry]),'baffled');
 const model={word:'admit',dictionary:{inflections:['admit','admits','admitted','admitting'],meanings:[{partOfSpeech:'verb'}]}};
 assert.equal(findVocabularyWord('admitting',[model]),'admit');assert.equal(findVocabularyWord('admission',[model]),null);
});
