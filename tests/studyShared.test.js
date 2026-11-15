const test = require('node:test');
const assert = require('node:assert/strict');
test('left article preserves unanalysed text and repeated sentence positions', () => {
  const { getSentenceRuns } = require('../public/studyShared');
  const text = 'Mr. Smith. Yes. Yes. Tail';
  const runs = getSentenceRuns(text, [{text:'Smith.'},{text:'Yes.'},{text:'Yes.'}]);
  assert.equal(runs.map(r => r.text).join(''), text);
  assert.deepEqual(runs.filter(r => r.index !== null).map(r => r.index), [0,1,2]);
  assert.equal(runs[0].text, 'Mr. ');
});
test('invalid or missing sentence ranges never erase the original article', () => {
  const { getSentenceRuns } = require('../public/studyShared');
  const text = '<Original> No.';
  assert.equal(getSentenceRuns(text, [{text:'invented', start:0, end:8}]).map(r=>r.text).join(''), text);
  assert.equal(getSentenceRuns(text, []).map(r=>r.text).join(''), text);
});
