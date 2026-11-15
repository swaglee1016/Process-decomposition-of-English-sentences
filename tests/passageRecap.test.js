const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {createApp} = require('../server');
const {saveResult} = require('../services/resultPersistence');

test('only a requested saved passage is summarized, persisted safely, and reused', async t => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'passage-recap-'));
  const passage = 'Rain fell.\n\nShe waited.';
  const sections = passage.split('\n\n').map(paragraph => ({paragraph, sentences:[{text:paragraph}]}));
  const {VocabularyStore} = require('../services/vocabularyStore');
  const store = new VocabularyStore(path.join(outputDir,'test.sqlite'));
  t.after(() => store.close());
  const token = store.issueCapability();
  const otherToken = store.issueCapability();
  const result = await saveResult({sections, outputDir,vocabulary:{token}});
  const calls = [];
  const recap = 'What happens — She waited through the rain. </script>';
  const oldHtml = await fs.readFile(result.outputPath, 'utf8');
  await fs.writeFile(result.outputPath, oldHtml.replace('id="passageRecapData">null', 'id="passageRecapData">"Old long-form recap."'));
  const app = createApp({outputDir,vocabularyStore:store, recapModel:async (system, source) => {
    calls.push(source);
    return recap;
  }});
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = 'http://127.0.0.1:' + server.address().port + '/api/passage-recap';
  const post = (filename, headers={}) => fetch(url, {method:'POST', headers:{'Content-Type':'application/json',...headers}, body:JSON.stringify({filename})});
  assert.equal((await post(result.filename, {Origin:'https://example.org'})).status, 403);
  assert.equal((await post('../server.js')).status, 400);
  const fileHeaders = key => ({Origin:'null', Authorization:'Bearer '+key});
  assert.equal((await post(result.filename,fileHeaders(otherToken))).status, 403);
  assert.deepEqual(calls, []);
  const responses = await Promise.all([post(result.filename), post(result.filename,fileHeaders(token))]);
  for (const response of responses) {
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {recap});
  }
  assert.deepEqual(calls, [passage]);
  const saved = await fs.readFile(result.outputPath, 'utf8');
  assert.ok(saved.includes('She waited through the rain.'));
  assert.ok(!saved.includes(recap));
  assert.equal((await post(result.filename)).status, 200);
  assert.equal((await post(result.filename,fileHeaders(otherToken))).status, 403);
  assert.deepEqual(calls, [passage]);
});

test('recap format rejects sprawling or unstructured replies and accepts short genre-specific outlines', () => {
  const {isCompactRecap} = require('../services/passageRecap');
  assert.ok(isCompactRecap('Main idea — Spare capacity can pay off.\n- Example — Reserves can be sold during a shortage.'));
  assert.ok(isCompactRecap('What happens — A cyclist loses her map and follows the river home.'));
  assert.ok(!isCompactRecap('The author discusses several topics in this chapter.'));
  assert.ok(!isCompactRecap('Main idea — ' + 'detail '.repeat(91)));
  assert.ok(!isCompactRecap('Main idea — Spare capacity matters.' + '\n- Example — More details.'.repeat(4)));
});
