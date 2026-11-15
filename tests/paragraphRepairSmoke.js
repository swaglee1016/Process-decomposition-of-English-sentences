// Manual acceptance: uses only this synthetic text with the configured model.
// Never reads or sends a user article. Retains the generated test outputs.
// Usage: node tests/paragraphRepairSmoke.js
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createApp } = require('../server');

async function main() {
  const source = [
    'Mr. Smith arrived at the empty station before sunrise. He placed his bag beside the wooden bench and studied the timetable. The rain had stopped, but the platform was still wet.',
    '"Has the morning train left?" Mrs. Jones asked.',
    '"Not yet," Mr. Smith replied. "It should arrive in ten minutes."',
    '"Then I have time to buy a ticket," she said.',
    '"I will watch your bag," he answered.',
    'The next afternoon, the town library opened a new reading room. Children gathered near the entrance while the librarian unlocked the doors. Volunteers carried boxes of books upstairs and arranged them on the shelves. By evening, every table was occupied and the little building was full of quiet conversation.'
  ].join(' ');
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'paragraph-fix-verification-'));
  const server = createApp({outputDir,delayMs:0}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let report;
  try {
    const previewResponse = await fetch(base+'/api/preview', {
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({text:source,paragraphMode:'pdf'}),signal:AbortSignal.timeout(60000)
    });
    assert.equal(previewResponse.status,200);
    const preview = await previewResponse.json();
    assert.deepEqual(preview.warnings,[], 'real model must succeed without fallback');
    assert.ok(preview.paragraphs.length >= 3, 'single-line dialogue and scene changes must be separated');
    assert.equal(preview.paragraphs.join(' '),source);
    report = {source:'synthetic dialogue only',beforeParagraphs:1,afterParagraphs:preview.paragraphs.length,
      longestParagraphWords:Math.max(...preview.paragraphs.map(p=>p.split(/\s+/).length)),warnings:preview.warnings,sourcePreserved:true};
    console.log(JSON.stringify({realParagraphPreview:report}));

    const events = await fetch(base+'/api/process', {
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({text:'Mr. Smith arrived.\n\nMrs. Jones left.',reviewed:true}),signal:AbortSignal.timeout(120000)
    }).then(r=>r.text());
    const complete = events.match(/event: complete\ndata: (.+)/);
    assert.ok(complete, 'real short generation must complete');
    const result = await fetch(base+'/api/result/'+JSON.parse(complete[1]).resultId).then(r=>r.json());
    assert.equal(result.sections.length,2);
    assert.equal((result.html.match(/class="diagram-canvas"/g)||[]).length,2);
    assert.equal((await fetch(base+result.outputUrl)).status,200);
    report.generatedSmoke = path.join(outputDir,result.filename);
    report.realShortSentenceDiagrams = 2;
  } finally {
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
  }
  assert.ok((await fs.readFile(report.generatedSmoke,'utf8')).includes('Mrs. Jones left.'));
  report.serverStopped = true;
  report.audit = path.join(outputDir,'verification.json');
  await fs.writeFile(report.audit,JSON.stringify(report,null,2),'utf8');
  console.log(JSON.stringify(report));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
