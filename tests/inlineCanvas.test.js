const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = require('../services/htmlBuilder');
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1000"></svg>').toString('base64');

test('SVG and PNG cards carry dimensions for layout before lazy decoding', () => {
  assert.match(html.buildSentenceHtml('Hi.',svg,'image/svg+xml'),/data-image-width="2000" data-image-height="1000"/);
  const viewBox = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 1700"></svg>').toString('base64');
  assert.match(html.buildSentenceHtml('Hi.',viewBox,'image/svg+xml'),/data-image-width="900" data-image-height="1700"/);
  const png = Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.writeUInt32BE(800,16);png.writeUInt32BE(1600,20);
  assert.match(html.buildSentenceHtml('Hi.',png.toString('base64'),'image/png'),/data-image-width="800" data-image-height="1600"/);
});

test('each sentence uses its own accessible inline canvas without an expand-link row', () => {
  const card = html.buildSentenceHtml('<script>unsafe()</script>', svg, 'image/svg+xml', 'old-companion.html');
  assert.match(card, /class="diagram-canvas"/);
  assert.match(card, /tabindex="0"/);
  assert.match(card, /data-canvas-action="fit"/);
  assert.match(card, /data-canvas-action="actual"/);
  assert.match(card, /class="canvas-image"/);
  assert.doesNotMatch(card, /diagram-open|展开查看|old-companion\.html/);
  assert.doesNotMatch(card, /<script>unsafe\(\)<\/script>/);
});

test('saved study embeds the same canvas interactions and styles without server assets', () => {
  const page = html.buildCompleteStudyHtml([{paragraph:'One. Two.',sentences:[
    {text:'One.',html:html.buildSentenceHtml('One.',svg,'image/svg+xml')},
    {text:'Two.',html:html.buildSentenceHtml('Two.',svg,'image/svg+xml')}
  ]}]);
  assert.equal((page.match(/class="diagram-canvas"/g)||[]).length, 2);
  assert.match(page, /InlineDiagramCanvas/);
  assert.match(page, /pointerdown/);
  assert.match(page, /Escape/);
  assert.doesNotMatch(page, /<script[^>]+src=|<link[^>]+stylesheet/);
});

test('online entry loads canvas assets and mounts canvases after sentence cards render', () => {
  const root=path.join(__dirname,'..');
  const entry=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
  const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
  assert.match(entry,/inlineDiagramCanvas\.css/);
  assert.match(entry,/inlineDiagramCanvas\.js/);
  assert.match(app,/InlineDiagramCanvas\.mount\(rightContent\)/);
});
