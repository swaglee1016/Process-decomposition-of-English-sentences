const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('web application entry exists and exposes every DOM hook used by app.js', () => {
  const entryPath = path.join(__dirname, '..', 'public', 'index.html');
  assert.equal(fs.existsSync(entryPath), true, 'public/index.html must be tracked');

  const document = fs.readFileSync(entryPath, 'utf8');
  const requiredIds = [
    'inputBar',
    'inputBarHeader',
    'inputArrow',
    'textInput',
    'fileInput',
    'fileBtn',
    'fileName',
    'dropZone',
    'processBtn',
    'progressBar',
    'statusText',
    'dualPanel',
    'panelRight',
    'leftContent',
    'rightContent',
    'timeEstimate',
    'downloadBtn',
    'savePath'
  ];

  for (const id of requiredIds) {
    assert.match(document, new RegExp(`id=["']${id}["']`), `missing #${id}`);
  }
  assert.match(document, /href=["']style\.css["']/);
  assert.match(document, /src=["']app\.js["']/);
  assert.match(document, /rel=["']icon["'][^>]+href=["']data:image\//);
});
