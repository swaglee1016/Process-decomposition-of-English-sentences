const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

let persistence = {};
try {
  persistence = require('../services/resultPersistence');
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}

test('saveResult writes a timestamped complete HTML file to the requested output directory', async () => {
  assert.equal(typeof persistence.saveResult, 'function');

  const outputDir = path.join(
    os.tmpdir(),
    'sentence-process-persistence-tests',
    `run-${Date.now()}-${process.pid}`
  );
  const sections = [
    {
      paragraph: 'Persistent article.',
      sentences: [
        {
          text: 'Persistent article.',
          html: '<div class="sent-card"><p>Persistent analysis</p><img alt="offline-diagram" src="data:image/png;base64,AA=="></div>'
        }
      ]
    }
  ];
  const now = new Date(2026, 7, 15, 10, 20, 30);

  const result = await persistence.saveResult({ sections, outputDir, now });

  assert.match(result.resultId, /^[0-9a-f-]{36}$/i);
  assert.match(result.filename, /^sentence-decomposition-20260815-102030(?:-\d+)?\.html$/);
  assert.equal(result.outputPath, path.join(outputDir, result.filename));

  const saved = await fs.readFile(result.outputPath, 'utf8');
  assert.equal(saved, result.html);
  assert.match(saved, /class="panel-left"/);
  assert.match(saved, /class="panel-right"/);
  assert.match(saved, /Persistent article\./);
  assert.match(saved, /Persistent analysis/);
  assert.match(saved, /data:image\/png;base64,AA==/);
});
