const test = require('node:test');
const assert = require('node:assert/strict');

const htmlBuilder = require('../services/htmlBuilder');

const sections = [
  {
    paragraph: 'Alpha sentence. Beta sentence.',
    sentences: [
      {
        text: 'Alpha sentence.',
        html: '<div class="sent-card"><p>Alpha analysis</p><img alt="diagram-marker" src="data:image/png;base64,AA=="></div>'
      },
      {
        text: 'Beta sentence.',
        html: '<div class="sent-card"><p>Beta analysis</p></div>'
      }
    ]
  }
];

test('complete study HTML preserves the full offline two-column result', () => {
  assert.equal(typeof htmlBuilder.buildCompleteStudyHtml, 'function');

  const document = htmlBuilder.buildCompleteStudyHtml(sections, {
    generatedAt: new Date('2026-08-15T10:20:30.000Z')
  });

  assert.match(document, /^<!DOCTYPE html>/i);
  assert.match(document, /class="panel-left"/);
  assert.match(document, /class="panel-right"/);
  assert.match(document, /Alpha sentence\./);
  assert.match(document, /Beta sentence\./);
  assert.match(document, /diagram-marker/);
  assert.match(document, /data:image\/png;base64,AA==/);
  assert.match(document, /scrollIntoView/);
  assert.doesNotMatch(document, /fetch\s*\(/);
  assert.doesNotMatch(document, /\/api\//);
});
