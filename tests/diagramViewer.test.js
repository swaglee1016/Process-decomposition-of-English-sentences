const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const html = require('../services/htmlBuilder');
const {saveResult} = require('../services/resultPersistence');
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1200"><text x="20" y="40">Diagram</text></svg>').toString('base64');
test('viewer page embeds safe image and offline controls, escaping sentence text', () => {
  assert.equal(typeof html.buildDiagramPage, 'function');
  const page=html.buildDiagramPage('<script>alert(1)</script>',svg,'image/svg+xml');
  assert.match(page,/data:image\/svg\+xml;base64,/);
  assert.match(page,/适配窗口/); assert.match(page,/100%/);
  assert.match(page,/pointerdown/); assert.match(page,/wheel/);
  assert.doesNotMatch(page,/<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(page,/<script[^>]+src=|fetch\s*\(|blob:/);
  assert.throws(()=>html.buildDiagramPage('x',svg,'text/html'));
});
test('saved result retains companion compatibility while the main page uses an inline canvas', async () => {
  const outputDir=await fs.mkdtemp(path.join(os.tmpdir(),'sentence-viewer-'));
  const result=await saveResult({outputDir,sections:[{paragraph:'Mr. Smith.',sentences:[{text:'Mr. Smith.',diagram:{base64:svg,mimeType:'image/svg+xml'}}]}]});
  assert.ok(result.sections?.[0].sentences[0].diagramFilename);
  const file=result.sections[0].sentences[0].diagramFilename;
  assert.match(file,/-diagram-1\.html$/);
  assert.match(result.html,/class="diagram-canvas"/);
  assert.doesNotMatch(result.html,/class="diagram-open"/);
  assert.ok(await fs.readFile(path.join(outputDir,file),'utf8'));
  assert.doesNotMatch(result.html,/href="\/outputs\//);
});
test('offline article retains source words even if sentence analysis omits them', () => {
  const page=html.buildCompleteStudyHtml([{paragraph:'Mr. Smith. Tail',sentences:[{text:'Smith.',html:'<p>Analysis</p>'}]}]);
  assert.match(page,/Mr\. /); assert.match(page,/Tail/);
});
test('simultaneous saves never overwrite one another or collide with orphan companions',async()=>{
  const outputDir=await fs.mkdtemp(path.join(os.tmpdir(),'sentence-concurrent-'));
  const now=new Date(2026,8,28,12,0,0);
  const makeSections=i=>[{paragraph:'Article '+i,sentences:[{text:'Article '+i,diagram:{base64:svg,mimeType:'image/svg+xml'}}]}];
  const results=await Promise.all([0,1,2,3].map(i=>saveResult({outputDir,now,sections:makeSections(i)})));
  assert.equal(new Set(results.map(r=>r.filename)).size,4);
  for(const result of results) assert.equal(await fs.readFile(result.outputPath,'utf8'),result.html);
  const another=await fs.mkdtemp(path.join(os.tmpdir(),'sentence-orphan-'));
  await fs.writeFile(path.join(another,'sentence-decomposition-20260928-120000-diagram-1.html'),'retained orphan');
  const saved=await saveResult({outputDir:another,now,sections:makeSections(5)});
  assert.match(saved.filename,/-1\.html$/);
});
