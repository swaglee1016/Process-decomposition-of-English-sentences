const test = require('node:test');
const assert = require('node:assert/strict');
const AdmZip = require('adm-zip');
const { parseEpub } = require('../services/epubParser');

function buildEpub(files) {
  const zip = new AdmZip();
  zip.addFile('mimetype', Buffer.from('application/epub+zip', 'utf8'));
  for (const [name, content] of Object.entries(files)) zip.addFile(name, Buffer.from(content, 'utf8'));
  return zip.toBuffer();
}

const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

function chapterPage(id, title, paragraphs) {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head>
<body><section id="${id}"><h1>${title}</h1>${paragraphs.map(p => `<p>${p}</p>`).join('')}</section></body></html>`;
}

test('EPUB3 nav table of contents keeps nesting and reading order', () => {
  const opf = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Sample &amp; Novel</dc:title></metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>`;
  const nav = `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>
<nav epub:type="toc"><ol>
  <li><a href="ch1.xhtml">Part One</a><ol>
    <li><a href="ch1.xhtml">Chapter 1</a></li>
    <li><a href="ch2.xhtml">Chapter 2</a></li>
  </ol></li>
</ol></nav></body></html>`;
  const book = parseEpub(buildEpub({
    'META-INF/container.xml': CONTAINER,
    'OEBPS/content.opf': opf,
    'OEBPS/nav.xhtml': nav,
    'OEBPS/ch1.xhtml': chapterPage('c1', 'Part One', ['First part intro.', 'Still intro.']),
    'OEBPS/ch2.xhtml': chapterPage('c2', 'Chapter 2', ['Second chapter begins.', 'It continues.']),
  }));
  assert.equal(book.title, 'Sample & Novel');
  assert.deepEqual(book.chapters.map(c => [c.title, c.depth]), [
    ['Part One', 0],
    ['Chapter 1', 1],
    ['Chapter 2', 1],
  ]);
  assert.equal(book.chapters[0].group, true, 'Part One duplicates Chapter 1 and becomes a header');
  assert.match(book.chapters[1].text, /First part intro\./);
  assert.match(book.chapters[2].text, /Second chapter begins\./);
});

test('chapter text keeps one line per paragraph and decodes entities', () => {
  const opf = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>T</dc:title></metadata>
  <manifest><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="c1"/></spine>
</package>`;
  const page = `<html xmlns="http://www.w3.org/1999/xhtml"><head>
<style>p{color:red}</style><script>var x=1;</script></head>
<body><h1>Chapter</h1>
<p>Tom said, &#8220;Wait&nbsp;&#8212; really?&#8221;</p>
<p>Anne &amp; Bob left.<br/>They hurried home.</p>
</body></html>`;
  const book = parseEpub(buildEpub({
    'META-INF/container.xml': CONTAINER,
    'OEBPS/content.opf': opf,
    'OEBPS/ch1.xhtml': page,
  }));
  assert.equal(book.documents.length, 1);
  const lines = book.documents[0].text.split('\n');
  assert.ok(lines.includes('Chapter'));
  assert.ok(lines.includes('Tom said, “Wait — really?”'));
  assert.ok(lines.includes('Anne & Bob left.'));
  assert.ok(lines.includes('They hurried home.'));
  assert.ok(!/var x|<p>/.test(book.documents[0].text));
});

test('table of contents fragments split one file into located sections', () => {
  const opf = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>T</dc:title></metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="all" href="all.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="all"/></spine>
</package>`;
  const nav = `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>
<nav epub:type="toc"><ol>
  <li><a href="all.xhtml#s1">Section A</a></li>
  <li><a href="all.xhtml#s2">Section B</a></li>
</ol></nav></body></html>`;
  const all = `<html xmlns="http://www.w3.org/1999/xhtml"><body>
<div id="s1"><p>Alpha text only.</p></div>
<div id="s2"><p>Beta text only.</p></div>
</body></html>`;
  const book = parseEpub(buildEpub({
    'META-INF/container.xml': CONTAINER,
    'OEBPS/content.opf': opf,
    'OEBPS/nav.xhtml': nav,
    'OEBPS/all.xhtml': all,
  }));
  assert.deepEqual(book.chapters.map(c => c.title), ['Section A', 'Section B']);
  assert.match(book.chapters[0].text, /Alpha text only\./);
  assert.doesNotMatch(book.chapters[0].text, /Beta/);
  assert.match(book.chapters[1].text, /Beta text only\./);
  assert.equal(book.chapters[0].text, 'Alpha text only.');
  assert.equal(book.chapters[1].text, 'Beta text only.');
});

test('single-quoted container attributes locate the OPF manifest', () => {
  const book = parseEpub(buildEpub({
    'META-INF/container.xml': CONTAINER.replaceAll('"', "'"),
    'OEBPS/content.opf': '<package><manifest><item id="c1" href="ch1.xhtml"/></manifest><spine><itemref idref="c1"/></spine></package>',
    'OEBPS/ch1.xhtml': '<html><body><p>A valid chapter.</p></body></html>',
  }));
  assert.equal(book.documents[0].text, 'A valid chapter.');
});

test('EPUB2 NCX table of contents is used when no nav document exists', () => {
  const opf = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Old Book</dc:title></metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="c1" href="text/c1.html" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx"><itemref idref="c1"/></spine>
</package>`;
  const ncx = `<?xml version="1.0"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>
  <navPoint id="n1" playOrder="1"><navLabel><text>Opening</text></navLabel><content src="text/c1.html"/></navPoint>
</navMap></ncx>`;
  const book = parseEpub(buildEpub({
    'META-INF/container.xml': CONTAINER,
    'OEBPS/content.opf': opf,
    'OEBPS/toc.ncx': ncx,
    'OEBPS/text/c1.html': '<html><body><p>It was a bright cold day in April.</p></body></html>',
  }));
  assert.equal(book.title, 'Old Book');
  assert.deepEqual(book.chapters.map(c => c.title), ['Opening']);
  assert.match(book.chapters[0].text, /bright cold day in April/);
});

test('books without any table of contents retain spine documents and offer unconfirmed named headings separately', () => {
  const opf = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>No Toc</dc:title></metadata>
  <manifest>
    <item id="c1" href="a.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="b.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>`;
  const book = parseEpub(buildEpub({
    'META-INF/container.xml': CONTAINER,
    'OEBPS/content.opf': opf,
    'OEBPS/a.xhtml': '<html><head><title>Alpha</title></head><body><h2>Alpha</h2><p>One.</p></body></html>',
    'OEBPS/b.xhtml': '<html><body><h2>Beta</h2><p>Two.</p></body></html>',
  }));
  assert.deepEqual(book.chapters, []);
  assert.deepEqual(book.navigation.candidates.map(c=>c.title), ['Alpha', 'Beta']);
  assert.match(book.documents[0].text,/One\./);
  assert.match(book.documents[1].text,/Two\./);
});

test('non-EPUB buffers are rejected with a clear error', () => {
  assert.throws(() => parseEpub(Buffer.from('not a zip file at all')), /EPUB/);
});

test('empty NCX distinguishes cover, title page and the full text instead of inventing chapters', () => {
  const book = parseEpub(buildEpub({
    'META-INF/container.xml': CONTAINER,
    'OEBPS/content.opf': '<package><metadata><dc:title>The Sample Book</dc:title><dc:creator>Sample Author</dc:creator></metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="cover" href="cover.html"/><item id="title" href="book_split_0.html"/><item id="body" href="book_split_1.html"/></manifest><spine><itemref idref="cover"/><itemref idref="title"/><itemref idref="body"/></spine><guide><reference type="cover" href="cover.html"/></guide></package>',
    'OEBPS/toc.ncx': '<ncx><docTitle><text>Table of Contents</text></docTitle><navMap/></ncx>',
    'OEBPS/cover.html': '<html><head><title>Cover</title></head><body></body></html>',
    'OEBPS/book_split_0.html': '<html><head><title>Unknown</title></head><body><p>The Sample Book</p><p>Sample Author</p></body></html>',
    'OEBPS/book_split_1.html': '<html><head><title>Unknown</title></head><body><p>The boat sailed\nacross the bay.</p><p>She returned home.</p></body></html>',
  }));
  assert.deepEqual(book.chapters, []);
  assert.deepEqual(book.documents.map(c=>c.kind), ['cover','frontmatter','body']);
  assert.equal(book.tocSource, 'spine');
  assert.equal(book.documents[1].text, 'The Sample Book\nSample Author');
  assert.equal(book.documents[2].text, 'The boat sailed across the bay.\nShe returned home.');
  assert.match(book.documents[2].original.html, /sailed\nacross/, 'original markup stays intact');
});

test('unnamed files remain reading materials while a named heading stays a candidate', () => {
  const book = parseEpub(buildEpub({
    'META-INF/container.xml': CONTAINER,
    'OEBPS/content.opf': '<package><manifest><item id="a" href="a.html"/><item id="b" href="b.html"/><item id="c" href="c.html"/></manifest><spine><itemref idref="a"/><itemref idref="b"/><itemref idref="c"/></spine></package>',
    'OEBPS/a.html': '<html><head><title>Unknown</title></head><body><p>A short opening.</p></body></html>',
    'OEBPS/b.html': '<html><head><title>Untitled</title></head><body><p>More text follows.</p></body></html>',
    'OEBPS/c.html': '<html><body><h2>Epilogue</h2><p>The end.</p></body></html>',
  }));
  assert.deepEqual(book.chapters, []);
  assert.equal(book.readingItems.length,3);
  assert.equal(book.navigation.candidates[0].title,'Epilogue');
});

test('source formatting whitespace does not split paragraphs, but blocks and explicit breaks do', () => {
  const book = parseEpub(buildEpub({
    'META-INF/container.xml': CONTAINER,
    'OEBPS/content.opf': '<package><manifest><item id="c" href="ch.html"/></manifest><spine><itemref idref="c"/></spine></package>',
    'OEBPS/ch.html': '<html><head><title>Untitled</title></head><body><h2>Opening</h2>\n<p>The boat\r\n  sailed <em>far\naway</em> today.\n\nIt returned.</p>\n<p>One.<br/>Two.</p><pre>Three.\nFour.</pre></body></html>',
  }));
  assert.equal(book.navigation.candidates[0].title, 'Opening');
  assert.equal(book.documents[0].text, 'Opening\nThe boat sailed far away today. It returned.\nOne.\nTwo.\nThree.\nFour.');
});

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('chapter images keep their position via the preceding paragraph anchor', () => {
  const opf = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>T</dc:title></metadata>
  <manifest><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="c1"/></spine>
</package>`;
  const page = `<html xmlns="http://www.w3.org/1999/xhtml"><body>
<p>Before the picture.</p>
<p><img src="images/scene.png" alt="A dark lane"/></p>
<p>After the picture.</p>
</body></html>`;
  const book = parseEpub(buildEpub({
    'META-INF/container.xml': CONTAINER,
    'OEBPS/content.opf': opf,
    'OEBPS/ch1.xhtml': page,
    'OEBPS/images/scene.png': Buffer.from(PNG_1PX, 'base64'),
  }));
  const chapter = book.documents[0];
  assert.equal(chapter.images.length, 1);
  assert.equal(chapter.images[0].anchor, 'Before the picture.');
  assert.equal(chapter.images[0].alt, 'A dark lane');
  assert.ok(chapter.images[0].dataUri.startsWith('data:image/png;base64,'));
  assert.equal(chapter.text, 'Before the picture.\nAfter the picture.');
});

test('chapter metadata title is not duplicated as visible article text', () => {
  const book = parseEpub(buildEpub({
    'META-INF/container.xml':CONTAINER,
    'OEBPS/content.opf':'<package><manifest><item id="c" href="ch.xhtml"/></manifest><spine><itemref idref="c"/></spine></package>',
    'OEBPS/ch.xhtml':chapterPage('c','Chapter One',['She waited.']),
  }));
  assert.equal(book.documents[0].text,'Chapter One\nShe waited.');
});

test('an image before any text gets an empty anchor', () => {
  const opf = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>T</dc:title></metadata>
  <manifest><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="c1"/></spine>
</package>`;
  const book = parseEpub(buildEpub({
    'META-INF/container.xml': CONTAINER,
    'OEBPS/content.opf': opf,
    'OEBPS/ch1.xhtml': '<html><body><img src="cover.png"/><p>Text follows.</p></body></html>',
    'OEBPS/cover.png': Buffer.from(PNG_1PX, 'base64'),
  }));
  assert.equal(book.documents[0].images[0].anchor, '');
});

test('TOC entries duplicating a child document become non-selectable group headers', () => {
  const opf = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>T</dc:title></metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>`;
  const nav = `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>
<nav epub:type="toc"><ol>
  <li><a href="ch1.xhtml">Part One</a><ol>
    <li><a href="ch1.xhtml">Chapter 1</a></li>
    <li><a href="ch2.xhtml">Chapter 2</a></li>
  </ol></li>
</ol></nav></body></html>`;
  const book = parseEpub(buildEpub({
    'META-INF/container.xml': CONTAINER,
    'OEBPS/content.opf': opf,
    'OEBPS/nav.xhtml': nav,
    'OEBPS/ch1.xhtml': '<html><body><h1>Chapter 1</h1><p>Real chapter text.</p></body></html>',
    'OEBPS/ch2.xhtml': '<html><body><h1>Chapter 2</h1><p>More text.</p></body></html>',
  }));
  assert.equal(book.chapters[0].group, true, 'Part One duplicates Chapter 1 and becomes a header');
  assert.equal(book.chapters[0].text, '');
  assert.equal(book.chapters[1].group, false);
  assert.match(book.chapters[1].text, /Real chapter text/);
});
test('split chapter documents include continuation files in text and original markup',()=>{
 const files={'META-INF/container.xml':CONTAINER,'OEBPS/content.opf':`<package><manifest><item id="a" href="part1_split_000.xhtml"/><item id="b" href="part1_split_001.xhtml"/><item id="c" href="part2_split_000.xhtml"/><item id="d" href="part2_split_001.xhtml"/><item id="toc" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest><spine toc="toc"><itemref idref="a"/><itemref idref="b"/><itemref idref="c"/><itemref idref="d"/></spine></package>`,'OEBPS/toc.ncx':`<ncx><navMap><navPoint><navLabel><text>CHAPTER ONE</text></navLabel><content src="part1_split_000.xhtml"/></navPoint><navPoint><navLabel><text>CHAPTER TWO</text></navLabel><content src="part2_split_000.xhtml"/></navPoint></navMap></ncx>`};
 for(const [name,text] of [['part1_split_000','Book title'],['part1_split_001','First chapter complete body.'],['part2_split_000','Book title'],['part2_split_001','Second chapter complete body.']])files['OEBPS/'+name+'.xhtml']=chapterPage(name,name,[text]);
 const book=parseEpub(buildEpub(files));assert.equal(book.chapters.length,2);assert.match(book.chapters[0].text,/First chapter complete body/);assert.doesNotMatch(book.chapters[0].text,/Second chapter complete body/);assert.match(book.chapters[1].text,/Second chapter complete body/);assert.ok(book.chapters[0].originalParts.some(part=>part.html.includes('First chapter complete body')));
});

test('a cover-only NCX cannot hide readable documents later in the spine', () => {
  const book = parseEpub(buildEpub({
    'META-INF/container.xml': CONTAINER,
    'OEBPS/content.opf': '<package><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="cover" href="cover.html"/><item id="body" href="story.html"/></manifest><spine toc="ncx"><itemref idref="cover"/><itemref idref="body"/></spine><guide><reference type="cover" href="cover.html"/></guide></package>',
    'OEBPS/toc.ncx': '<ncx><navMap><navPoint><navLabel><text>Start</text></navLabel><content src="cover.html"/></navPoint></navMap></ncx>',
    'OEBPS/cover.html': '<html><head><title>Cover</title></head><body><img src="cover.png"/></body></html>',
    'OEBPS/cover.png': Buffer.from(PNG_1PX, 'base64'),
    'OEBPS/story.html': '<html><head><title>Unknown</title></head><body><p>The full story begins.</p><p>The story ends.</p></body></html>',
  }));
  assert.equal(book.tocSource, 'spine');
  assert.equal(book.chapters.length,0);
  assert.equal(book.documents[0].kind,'cover');
  assert.equal(book.documents[1].text,'The full story begins.\nThe story ends.');
  assert.match(book.documents[1].original.html,/The story ends/);
});

test('split continuation merging stops before a guide-declared HTML table of contents', () => {
  const book = parseEpub(buildEpub({
    'META-INF/container.xml': CONTAINER,
    'OEBPS/content.opf': '<package><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="a" href="index_split_003.html"/><item id="b" href="index_split_004.html"/><item id="toc" href="index_split_005.html"/></manifest><spine toc="ncx"><itemref idref="a"/><itemref idref="b"/><itemref idref="toc"/></spine><guide><reference type="toc" href="index_split_005.html#contents"/></guide></package>',
    'OEBPS/toc.ncx': '<ncx><navMap><navPoint><navLabel><text>The Story</text></navLabel><content src="index_split_003.html"/></navPoint></navMap></ncx>',
    'OEBPS/index_split_003.html': '<html><body><p>The story begins.</p></body></html>',
    'OEBPS/index_split_004.html': '<html><body><p>The actual ending.</p></body></html>',
    'OEBPS/index_split_005.html': '<html><body><h2 id="contents">Table of Contents</h2><a href="index_split_003.html">The Story</a></body></html>',
  }));
  assert.equal(book.tocSource,'navigation');
  assert.equal(book.chapters.length,1);
  assert.equal(book.chapters[0].text,'The story begins.\nThe actual ending.');
  assert.equal(book.chapters[0].originalParts.length,2);
  assert.ok(book.chapters[0].originalParts.every(part=>!part.html.includes('Table of Contents')));
});

test('a NCX with a cover and a readable chapter remains authoritative', () => {
  const book = parseEpub(buildEpub({
    'META-INF/container.xml': CONTAINER,
    'OEBPS/content.opf': '<package><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="a" href="cover.html"/><item id="b" href="body.html"/></manifest><spine toc="ncx"><itemref idref="a"/><itemref idref="b"/></spine></package>',
    'OEBPS/toc.ncx': '<ncx><navMap><navPoint><navLabel><text>Cover</text></navLabel><content src="cover.html"/></navPoint><navPoint><navLabel><text>Chapter One</text></navLabel><content src="body.html"/></navPoint></navMap></ncx>',
    'OEBPS/cover.html': '<html><body></body></html>',
    'OEBPS/body.html': '<html><body><p>The chapter text.</p></body></html>',
  }));
  assert.equal(book.tocSource,'navigation');
  assert.deepEqual(book.chapters.map(c=>c.title),['Cover','Chapter One']);
  assert.equal(book.chapters[1].text,'The chapter text.');
});
