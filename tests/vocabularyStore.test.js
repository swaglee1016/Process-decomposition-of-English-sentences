const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
function storePath(){return path.join(fs.mkdtempSync(path.join(os.tmpdir(),'vocabulary-store-')),'vocabulary.sqlite');}
test('vocabulary is persistent, case insensitive, and duplicate collection cannot undo an existing word',()=>{
const {VocabularyStore}=require('../services/vocabularyStore');
  const filename=storePath();let store=new VocabularyStore(filename);
  const first=store.add({word:'Fell',context:'Rain fell.',source:'Chapter One'});
  assert.equal(first.created,true);assert.ok(first.actionId);
  const duplicate=store.add({word:'fell'});
  assert.equal(duplicate.created,false);assert.equal(duplicate.actionId,null);
  store.close();store=new VocabularyStore(filename);
  assert.equal(store.list().length,1);assert.equal(store.detail('FELL').context,'Rain fell.');
  assert.equal(store.undo(first.actionId).undone,true);assert.equal(store.list().length,0);
  const again=store.add({word:'fell'});assert.equal(again.created,true);
  assert.equal(store.undo(first.actionId).undone,false);assert.equal(store.list().length,1);
  store.close();
});
test('dictionary cache and restricted capabilities survive a database restart',()=>{
  const {VocabularyStore}=require('../services/vocabularyStore');
  const filename=storePath();let store=new VocabularyStore(filename);
  store.add({word:'rain'});
  store.updateLookup('rain',{dictionary:{word:'rain',phonetics:[{text:'/reɪn/'}],meanings:[{partOfSpeech:'noun',definitions:[{definition:'Water falling from clouds.'}]}]},audioDataUri:'data:audio/mpeg;base64,SUQz',error:''});
  const token=store.issueCapability();assert.equal(store.authorize('invalid'),false);
  store.close();store=new VocabularyStore(filename);
  assert.equal(store.authorize(token),true);
  assert.equal(store.detail('rain').dictionary.meanings[0].partOfSpeech,'noun');
  assert.match(store.detail('rain').audioDataUri,/^data:audio\/mpeg/);
  assert.equal(store.list()[0].audioDataUri,undefined);
  assert.match(store.snapshot().words[0].audioDataUri,/^data:audio\/mpeg/);
  store.close();
});
test('invalid terms and oversized context are rejected without database writes',()=>{
  const {VocabularyStore}=require('../services/vocabularyStore');const store=new VocabularyStore(storePath());
  for(const word of ["rain'; DROP TABLE words;--",'two words','<script>','', 'x'.repeat(65)])assert.throws(()=>store.add({word}),/单词/);
  assert.throws(()=>store.add({word:'rain',context:'x'.repeat(4001)}),/原句/);
  assert.equal(store.list().length,0);store.close();
});
