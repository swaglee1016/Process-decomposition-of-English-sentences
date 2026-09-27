const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('server saves a completed result before announcing completion', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const saveCall = source.indexOf('await saveResult(');
  const completeEvent = source.indexOf("sse(res, 'complete'");

  assert.notEqual(saveCall, -1, 'server must call saveResult');
  assert.notEqual(completeEvent, -1, 'server must emit the complete event');
  assert.ok(saveCall < completeEvent, 'disk save must finish before completion is reported');
  assert.match(source, /app\.use\(['"]\/output['"],\s*express\.static\(/);
  assert.match(source, /process\.env\.PORT\s*\|\|\s*3456/);
});

test('browser opens the persisted output instead of creating a temporary Blob URL', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

  assert.match(source, /result\.outputUrl/);
  assert.match(source, /savePath\.textContent/);
  assert.doesNotMatch(source, /new Blob\s*\(/);
  assert.doesNotMatch(source, /URL\.createObjectURL\s*\(/);
});
