const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const AdmZip = require('adm-zip');

function sampleEpub() {
  const zip = new AdmZip();
  zip.addFile('mimetype', Buffer.from('application/epub+zip', 'utf8'));
  zip.addFile('META-INF/container.xml', Buffer.from(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`, 'utf8'));
  zip.addFile('OEBPS/content.opf', Buffer.from(`<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Demo Novel</dc:title></metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>`, 'utf8'));
  zip.addFile('OEBPS/nav.xhtml', Buffer.from(`<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>
<nav epub:type="toc"><ol>
  <li><a href="ch1.xhtml">Chapter One</a></li>
  <li><a href="ch2.xhtml">Chapter Two</a></li>
</ol></nav></body></html>`, 'utf8'));
  zip.addFile('OEBPS/ch1.xhtml', Buffer.from(`<html xmlns="http://www.w3.org/1999/xhtml"><body>
<h1>Chapter One</h1><p>Mr. Darcy arrived early.</p><p>The room fell silent.</p></body></html>`, 'utf8'));
  zip.addFile('OEBPS/ch2.xhtml', Buffer.from(`<html xmlns="http://www.w3.org/1999/xhtml"><body>
<h1>Chapter Two</h1><p>Elizabeth laughed.</p></body></html>`, 'utf8'));
  return zip.toBuffer();
}

async function startApp() {
  const { createApp } = require('../server');
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sentence-epub-http-'));
  const app = createApp({ outputDir, delayMs: 0,
    analyzeSentence: async () => '{"puml":"@startmindmap\\n* Test\\n@endmindmap"}',
    renderDiagram: async () => null,
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function stopServer(server) {
  if (!server.listening) return;
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}

test('EPUB upload returns a table of contents and chapters feed the preview flow', async () => {
  const { server, base } = await startApp();
  try {
    const tocForm = new FormData();
    tocForm.append('file', new Blob([sampleEpub()], { type: 'application/epub+zip' }), 'demo.epub');
    const tocResponse = await fetch(base + '/api/epub/toc', { method: 'POST', body: tocForm });
    assert.equal(tocResponse.status, 200);
    const toc = await tocResponse.json();
    assert.equal(toc.title, 'Demo Novel');
    assert.ok(toc.bookId);
    assert.deepEqual(toc.chapters.map(c => c.title), ['Chapter One', 'Chapter Two']);
    assert.ok(toc.chapters[0].words > 0);

    const chapterResponse = await fetch(base + '/api/epub/chapter', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookId: toc.bookId, id: toc.chapters[0].id }),
    });
    assert.equal(chapterResponse.status, 200);
    const chapter = await chapterResponse.json();
    assert.equal(chapter.title, 'Chapter One');
    assert.match(chapter.text, /Mr\. Darcy arrived early\./);

    const previewForm = new FormData();
    previewForm.append('text', chapter.text);
    previewForm.append('paragraphMode', 'preserve');
    const preview = await fetch(base + '/api/preview', { method: 'POST', body: previewForm }).then(r => r.json());
    const allSentences = preview.sections.flatMap(s => s.sentences.map(x => x.text));
    assert.ok(allSentences.includes('Mr. Darcy arrived early.'));
    assert.ok(allSentences.includes('The room fell silent.'));
  } finally { await stopServer(server); }
});

test('EPUB chapter requests validate book and chapter identifiers', async () => {
  const { server, base } = await startApp();
  try {
    const missing = await fetch(base + '/api/epub/chapter', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookId: 'nope', id: '0' }),
    });
    assert.equal(missing.status, 404);

    const tocForm = new FormData();
    tocForm.append('file', new Blob([sampleEpub()]), 'demo.epub');
    const toc = await fetch(base + '/api/epub/toc', { method: 'POST', body: tocForm }).then(r => r.json());
    const badChapter = await fetch(base + '/api/epub/chapter', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookId: toc.bookId, id: '99' }),
    });
    assert.equal(badChapter.status, 404);
  } finally { await stopServer(server); }
});

test('EPUB files sent to the plain preview endpoint get a chapter-selection hint', async () => {
  const { server, base } = await startApp();
  try {
    const form = new FormData();
    form.append('file', new Blob([sampleEpub()]), 'demo.epub');
    form.append('paragraphMode', 'preserve');
    const response = await fetch(base + '/api/preview', { method: 'POST', body: form });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /章节/);
  } finally { await stopServer(server); }
});

test('corrupt EPUB uploads are rejected with a clear error', async () => {
  const { server, base } = await startApp();
  try {
    const form = new FormData();
    form.append('file', new Blob([Buffer.from('definitely not a zip')]), 'broken.epub');
    const response = await fetch(base + '/api/epub/toc', { method: 'POST', body: form });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /EPUB/);
  } finally { await stopServer(server); }
});

test('EPUB without navigation reports spine contents and still loads its text', async () => {
  const { server, base } = await startApp();
  try {
    const zip = new AdmZip(sampleEpub());
    zip.updateFile('OEBPS/nav.xhtml', Buffer.from('<html><body><nav epub:type="toc"><ol/></nav></body></html>'));
    const form = new FormData();
    form.append('file', new Blob([zip.toBuffer()]), 'no-toc.epub');
    const response = await fetch(base + '/api/epub/toc', {method:'POST',body:form});
    assert.equal(response.status,200);
    const book = await response.json();
    assert.equal(book.navigation.source,'headings');
    assert.equal(book.chapters[0].title,'Chapter One');
    const chapter = await fetch(base+'/api/epub/chapter',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({bookId:book.bookId,id:'1'})}).then(r=>r.json());
    assert.match(chapter.text,/Elizabeth laughed\./);
  } finally { await stopServer(server); }
});

test('no chapter directory still offers explicit reading mode without manufacturing chapters', async () => {
  const {makeBook,page}=require('./epubNavigationFixture');
  const {server,base}=await startApp();
  try{
    const form=new FormData();form.append('file',new Blob([makeBook({pages:{'a.html':page('<h2>By Sample Author</h2>'),'b.html':page('<h3 class="sigilnotintoc">Dedication</h3><p>Readable story.</p>')}})]),'no-chapters.epub');
    const book=await fetch(base+'/api/epub/toc',{method:'POST',body:form}).then(r=>r.json());
    assert.equal(book.navigation.status,'not-found');assert.deepEqual(book.chapters,[]);assert.equal(book.reading.items.length,2);
    assert.ok(!JSON.stringify(book).includes('<html>'),'TOC metadata must not ship all raw HTML');
    const response=await fetch(base+'/api/epub/chapter',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({bookId:book.bookId,mode:'reading'})});
    assert.equal(response.status,200);const data=await response.json();assert.match(data.text,/Readable story/);assert.match(data.title,/阅读预览/);assert.equal(data.original.chapters.length,2);
    const invalid=await fetch(base+'/api/epub/chapter',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({bookId:book.bookId,mode:'reading',ids:['made-up']})});assert.equal(invalid.status,404);
  }finally{await stopServer(server);}
});

test('multiple chapters can be loaded together in reading order', async () => {
  const { server, base } = await startApp();
  try {
    const tocForm = new FormData();
    tocForm.append('file', new Blob([sampleEpub()]), 'demo.epub');
    const toc = await fetch(base + '/api/epub/toc', { method: 'POST', body: tocForm }).then(r => r.json());

    const response = await fetch(base + '/api/epub/chapter', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookId: toc.bookId, ids: ['1', '0'] }),
    });
    assert.equal(response.status, 200);
    const combined = await response.json();
    assert.match(combined.title, /2/);
    const first = combined.text.indexOf('Mr. Darcy arrived early.');
    const second = combined.text.indexOf('Elizabeth laughed.');
    assert.ok(first >= 0 && second > first, 'chapters are concatenated in table-of-contents order regardless of request order');
    assert.equal(combined.original.chapters.length,2);
    assert.match(combined.original.chapters[0].html,/Mr\. Darcy arrived early/);
    assert.match(combined.original.chapters[1].html,/Elizabeth laughed/);
    const processForm = new FormData();
    processForm.append('text',combined.text);
    processForm.append('reviewed','true');
    processForm.append('original',JSON.stringify(combined.original));
    const events = await fetch(base+'/api/process',{method:'POST',body:processForm}).then(r=>r.text());
    const complete = events.match(/event: complete\ndata: (.+)/);
    assert.ok(complete,events);
    const result = await fetch(base+'/api/result/'+JSON.parse(complete[1]).resultId).then(r=>r.json());
    assert.equal(result.original.chapters.length,2);
    assert.match(result.html,/id="epubOriginalData"/);
    assert.match(result.html,/id="readingModeToggle"/);
  } finally { await stopServer(server); }
});

test('images sent with the analysed text are embedded in the saved left column', async () => {
  const { server, base } = await startApp();
  try {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const form = new FormData();
    form.append('text', 'Mr. Smith left.\n\nThe next morning Mrs. Jones arrived.');
    form.append('reviewed', 'true');
    form.append('images', JSON.stringify([
      { anchor: 'Mr. Smith left.', dataUri: 'data:image/png;base64,' + png, alt: 'lane' },
      { anchor: 'no such paragraph anywhere', dataUri: 'data:image/png;base64,' + png, alt: 'lost' },
      { anchor: 'The next morning Mrs. Jones arrived.', dataUri: 'javascript:alert(1)', alt: 'bad' },
    ]));
    const events = await fetch(base + '/api/process', { method: 'POST', body: form }).then(r => r.text());
    const complete = events.match(/event: complete\ndata: (.+)/);
    assert.ok(complete, events);
    assert.match(events, /插图/);
    const result = await fetch(base + '/api/result/' + JSON.parse(complete[1]).resultId).then(r => r.json());
    const withImage = result.sections.find(s => s.images && s.images.length);
    assert.ok(withImage, 'one section carries the located image');
    assert.equal(withImage.paragraph, 'Mr. Smith left.');
    assert.ok(!result.sections.some(s => (s.images || []).some(i => i.dataUri.startsWith('javascript:'))), 'invalid data URIs are rejected');
    assert.match(result.html, /article-image/);
  } finally { await stopServer(server); }
});
