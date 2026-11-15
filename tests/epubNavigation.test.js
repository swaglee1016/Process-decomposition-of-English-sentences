const test = require('node:test');
const assert = require('node:assert/strict');
const {parseEpub} = require('../services/epubParser');
const {makeBook,page,ncx,nav} = require('./epubNavigationFixture');

test('document titles, author headings and excluded dedications never become invented chapters', () => {
  const book=parseEpub(makeBook({pages:{
    'title.html':page('<p>The Sample Book</p>'),
    'author.html':page('<h2>By Sample Author</h2>'),
    'story.html':page('<h3 class="sigilnotintoc">To Charlie</h3><p>The story starts.</p><p>The story ends.</p>'),
  }}));
  assert.equal(book.navigation.status,'not-found');
  assert.deepEqual(book.chapters,[]);
  assert.equal(book.documents.length,3);
  assert.ok(book.readingItems.some(item=>item.text.includes('The story ends.')));
});

test('cover-only navigation leaves chapter list empty without hiding reading materials', () => {
  const book=parseEpub(makeBook({pages:{'cover.html':page('<img src="cover.png"/>'),'story.html':page('<p>The whole story.</p>')},
    ncx:ncx([['Start','cover.html']]),guide:'<reference type="cover" href="cover.html"/>'}));
  assert.equal(book.navigation.status,'not-found');
  assert.equal(book.chapters.length,0);
  assert.match(book.readingItems.map(item=>item.text).join(' '),/The whole story/);
});

test('single book-title entry is reported as a body entry and excludes a trailing HTML TOC', () => {
  const book=parseEpub(makeBook({pages:{
    'story_split_0.html':page('<p>The story begins.</p>'),
    'story_split_1.html':page('<p>The final sentence.</p>'),
    'story_split_2.html':page('<h2 id="toc">Contents</h2><a href="story_split_0.html">Sample Book</a>'),
  },ncx:ncx([['Sample Book','story_split_0.html']]),guide:'<reference type="toc" href="story_split_2.html#toc"/>'}));
  assert.equal(book.navigation.status,'single-body-entry');
  assert.equal(book.chapters[0].title,'Sample Book');
  assert.equal(book.chapters[0].text,'The story begins.\nThe final sentence.');
  assert.equal(book.chapters[0].originalParts.length,2);
});

test('numbered headings in one file yield real chapter ranges, including their own titles', () => {
  const book=parseEpub(makeBook({pages:{'book.html':page('<h2 id="one">Chapter One</h2><p>Alpha.</p><h2 id="two">Chapter Two</h2><p>Beta.</p>')}}));
  assert.equal(book.navigation.status,'chapters');
  assert.equal(book.navigation.source,'headings');
  assert.deepEqual(book.chapters.map(c=>c.title),['Chapter One','Chapter Two']);
  assert.equal(book.chapters[0].text,'Chapter One\nAlpha.');
  assert.equal(book.chapters[1].text,'Chapter Two\nBeta.');
  assert.ok(book.chapters.every(c=>c.evidence && c.ranges.length));
});

test('a lone unnamed heading is a review candidate, not a confirmed chapter', () => {
  const book=parseEpub(makeBook({pages:{'book.html':page('<h2 id="h">A Quiet Morning</h2><p>She waited.</p>')}}));
  assert.equal(book.navigation.status,'uncertain');
  assert.equal(book.chapters.length,0);
  assert.equal(book.navigation.candidates[0].title,'A Quiet Morning');
  assert.match(book.navigation.candidates[0].text,/She waited/);
});

test('bold phrases and printed page numbers do not manufacture chapter structure', () => {
  const book=parseEpub(makeBook({pages:{'book.html':page('<p><b>A Quiet Morning</b></p><p>49</p><p>IV</p><p>The story continues.</p>')}}));
  assert.equal(book.navigation.status,'not-found');
  assert.deepEqual(book.chapters,[]);
  assert.deepEqual(book.navigation.candidates,[]);
  assert.match(book.readingItems[0].text,/The story continues/);
});

test('chapter semantic markup supports a genuinely single named chapter', () => {
  const book=parseEpub(makeBook({pages:{'book.html':page('<section epub:type="chapter" id="c"><h1>A Quiet Morning</h1><p>She waited.</p></section>')}}));
  assert.equal(book.navigation.status,'chapters');
  assert.equal(book.chapters[0].title,'A Quiet Morning');
});

test('guide-declared linked HTML contents are extracted when NCX is empty', () => {
  const book=parseEpub(makeBook({pages:{
    'toc.html':page('<h1>Contents</h1><ol><li><a href="story.html#a">Opening</a></li><li><a href="story.html#b">Closing</a></li></ol>'),
    'story.html':page('<h2 id="a">Opening</h2><p>Alpha.</p><h2 id="b">Closing</h2><p>Beta.</p>'),
  },ncx:'<ncx><navMap/></ncx>',guide:'<reference type="toc" href="toc.html"/>'}));
  assert.equal(book.navigation.source,'html-toc');
  assert.deepEqual(book.chapters.map(c=>c.title),['Opening','Closing']);
  assert.doesNotMatch(book.chapters[0].text,/Closing|Beta/);
});

test('explicit navigation can preserve a dedication even when automatic inference excludes it', () => {
  const book=parseEpub(makeBook({pages:{'book.html':page('<h2 id="d" class="sigil_not_in_toc">Dedication</h2><p>To a friend.</p><h2 id="c">Chapter One</h2><p>The story.</p>')},
    nav:nav([['Dedication','book.html#d'],['Chapter One','book.html#c']])}));
  assert.deepEqual(book.chapters.map(c=>c.title),['Dedication','Chapter One']);
  assert.ok(book.navigation.warnings.some(w=>w.code==='excluded-heading-reference'));
});

test('invalid anchor is reported and cannot silently turn into the whole document', () => {
  const book=parseEpub(makeBook({pages:{'story.html':page('<p>Important text.</p>')},nav:nav([['Missing','story.html#missing']])}));
  assert.equal(book.navigation.status,'uncertain');
  assert.equal(book.chapters.length,0);
  assert.ok(book.navigation.warnings.some(w=>w.code==='invalid-target'));
  assert.match(book.readingItems[0].text,/Important text/);
});

test('partially populated navigation keeps unlisted chapter separately accessible', () => {
  const book=parseEpub(makeBook({pages:{'story.html':page('<h2 id="one">Chapter One</h2><p>Alpha.</p><h2 id="two">Chapter Two</h2><p>Beta.</p>')},nav:nav([['Chapter One','story.html#one']])}));
  assert.equal(book.navigation.status,'uncertain');
  assert.equal(book.chapters.length,1);
  assert.doesNotMatch(book.chapters[0].text,/Beta/);
  assert.ok(book.navigation.candidates.some(c=>c.title==='Chapter Two' && c.text.includes('Beta')));
  assert.ok(book.navigation.coverage.uncovered.some(r=>r.path==='OPS/story.html'));
});

test('ranges support a chapter continued in a differently named spine file before the next chapter', () => {
  const book=parseEpub(makeBook({pages:{
    'opening.html':page('<h2 id="a">Chapter One</h2><p>Alpha.</p>'),
    'continued.html':page('<p>Still the first chapter.</p>'),
    'closing.html':page('<h2 id="b">Chapter Two</h2><p>Beta.</p>'),
  },nav:nav([['Chapter One','opening.html#a'],['Chapter Two','closing.html#b']])}));
  assert.match(book.chapters[0].text,/Still the first chapter/);
  assert.doesNotMatch(book.chapters[0].text,/Beta/);
  assert.equal(book.chapters[0].originalParts.length,2);
});

test('conflicting lower-priority navigation is diagnosed without silently merging chapters', () => {
  const book=parseEpub(makeBook({pages:{'story.html':page('<h2 id="a">Opening</h2><p>Alpha.</p><h2 id="b">Closing</h2><p>Beta.</p>')},
    nav:nav([['Opening','story.html#a']]),ncx:ncx([['Different name','story.html#a'],['Closing','story.html#b']])}));
  assert.equal(book.navigation.source,'nav');
  assert.equal(book.chapters.length,1);
  assert.equal(book.chapters[0].title,'Opening');
  assert.ok(book.navigation.candidates.some(c=>c.title==='Closing'));
  assert.ok(book.navigation.warnings.some(w=>w.code==='source-conflict'));
});

test('malformed navigation and external entity declarations fail safely without hiding text', () => {
  const book=parseEpub(makeBook({pages:{'story.html':page('<p>Safe content.</p>')},ncx:'<!DOCTYPE ncx [<!ENTITY secret SYSTEM "file:///private">]><ncx><navMap><navPoint></ncx>'}));
  assert.equal(book.navigation.status,'uncertain');
  assert.equal(book.chapters.length,0);
  assert.ok(book.navigation.warnings.some(w=>w.code==='invalid-navigation'));
  assert.match(book.readingItems[0].text,/Safe content/);
});

test('heading budget rejects a compact book before unbounded candidate matching', () => {
  const body=Array.from({length:1100},(_,i)=>`<h2>Chapter ${i+1}</h2><p>Text.</p>`).join('');
  assert.throws(()=>parseEpub(makeBook({pages:{'many.html':page(body)}})),/标题数量超过限制/);
});

test('aggregate decompressed text budget is enforced before building all document trees', () => {
  const large=page('<p>'+'x'.repeat(7*1024*1024)+'</p>');
  assert.throws(()=>parseEpub(makeBook({pages:Object.fromEntries(Array.from({length:5},(_,i)=>[`${i}.html`,large]))})),/累计文本超过 32 MB/);
});

test('Chinese numbered chapter titles do not require spaces before their names', () => {
  const book=parseEpub(makeBook({pages:{'story.html':page('<h2>第一章启程</h2><p>出发。</p><h2>第二章归来</h2><p>回来。</p>')}}));
  assert.equal(book.navigation.status,'chapters');
  assert.deepEqual(book.chapters.map(c=>c.title),['第一章启程','第二章归来']);
});

test('wrong NCX root is uncertain rather than proof that the book lacks chapters', () => {
  const book=parseEpub(makeBook({pages:{'story.html':page('<p>Safe content.</p>')},ncx:'<html><body>Not NCX</body></html>'}));
  assert.equal(book.navigation.status,'uncertain');
  assert.ok(book.navigation.warnings.some(w=>w.code==='invalid-navigation'));
});

test('deep markup is rejected before repeated ancestor inspection', () => {
  assert.throws(()=>parseEpub(makeBook({pages:{'deep.html':page('<div>'.repeat(300)+'Text'+'</div>'.repeat(300))}})),/嵌套层级超过限制/);
});

test('file start and an empty leading anchor identify the same body entry across NCX and HTML TOC', () => {
  const book=parseEpub(makeBook({pages:{
    'story_split_003.html':page('\n<span id="start"></span><p>The story begins.</p>'),
    'story_split_004.html':page('<p>The actual ending.</p>'),
    'story_split_005.html':page('<a href="story_split_003.html#start">Sample Book</a>'),
  },ncx:ncx([['Sample Book','story_split_003.html']]),guide:'<reference type="toc" href="story_split_005.html"/>'}));
  assert.equal(book.navigation.status,'single-body-entry');
  assert.equal(book.navigation.candidates.length,0);
  assert.equal(book.chapters[0].text,'The story begins.\nThe actual ending.');
  assert.equal(book.chapters[0].originalParts.length,2);
});

test('duplicate manifest navigation references are parsed once per source and path', () => {
  const AdmZip=require('adm-zip');const zip=new AdmZip(makeBook({pages:{'story.html':page('<p>Story.</p>')},nav:nav([['Sample Book','story.html']])}));
  const opf=zip.readAsText('OPS/book.opf').replace('</manifest>',Array.from({length:60},(_,i)=>`<item id="duplicate${i}" href="nav.xhtml" properties="nav"/>`).join('')+'</manifest>');
  zip.updateFile('OPS/book.opf',Buffer.from(opf));
  const book=parseEpub(zip.toBuffer());assert.equal(book.navigation.sourceCounts.length,1);
});

test('navigation source count is bounded before parsing further sources', () => {
  const AdmZip=require('adm-zip');const zip=new AdmZip(makeBook({pages:{'story.html':page('<p>Story.</p>')}}));let manifest='';
  for(let i=0;i<40;i++){const path=`nav${i}.html`;manifest+=`<item id="nav${i}" href="${path}" properties="nav"/>`;zip.addFile('OPS/'+path,Buffer.from(nav([['Sample Book','story.html']])));}
  zip.updateFile('OPS/book.opf',Buffer.from(zip.readAsText('OPS/book.opf').replace('</manifest>',manifest+'</manifest>')));
  const book=parseEpub(zip.toBuffer());assert.ok(book.navigation.sourceCounts.length<=32);assert.ok(book.navigation.warnings.some(w=>w.code==='navigation-source-limit'));assert.equal(book.navigation.status,'uncertain');
});

function authorSortedBook(options) {
  const AdmZip=require('adm-zip');
  const zip=new AdmZip(makeBook({...options,creator:'Sample Author'}));
  zip.updateFile('OPS/book.opf',Buffer.from(zip.readAsText('OPS/book.opf').replace('<dc:creator>', '<dc:creator xmlns:opf="http://www.idpf.org/2007/opf" opf:file-as="Author, Sample">')));
  return zip.toBuffer();
}

test('author-prefixed metadata does not turn the title page into a whole-book chapter candidate', () => {
  const book=parseEpub(authorSortedBook({title:'Author, Sample - The Sample Book',pages:{
    'cover.html':page('<img src="cover.png"/>'),
    'story_split_000.html':page('<p>For a friend.</p>'),
    'story_split_001.html':page('<h2>THE SAMPLE BOOK</h2><p>Sample Author</p>'),
    'story_split_002.html':page('<h3 class="sigilnotintoc">THE SAMPLE BOOK</h3><p>The story begins.</p><p>The story ends.</p>'),
  },ncx:ncx([['Start','cover.html']]),guide:'<reference type="cover" href="cover.html"/>'}));
  assert.equal(book.navigation.status,'not-found');
  assert.deepEqual(book.chapters,[]);
  assert.deepEqual(book.navigation.candidates,[]);
  assert.equal(book.documents.find(d=>d.path.endsWith('001.html')).kind,'frontmatter');
  assert.equal(book.readingItems.length,4,'all source materials remain accessible');
  assert.equal(book.readingItems.map(item=>item.text).filter(Boolean).join('\n'),
    'For a friend.\nTHE SAMPLE BOOK\nSample Author\nTHE SAMPLE BOOK\nThe story begins.\nThe story ends.');
});

test('explicit single body entry accepts a title with a metadata-author prefix or suffix', () => {
  for(const title of ['Author, Sample - The Sample Book','Sample Author: The Sample Book','The Sample Book — Sample Author']) {
    const book=parseEpub(authorSortedBook({title,pages:{
      'title.html':page('<h1>THE SAMPLE BOOK</h1><p>Sample Author</p>'),
      'story.html':page('<p>The complete story.</p>')},ncx:ncx([['The Sample Book','story.html']])}));
    assert.equal(book.navigation.status,'single-body-entry',title);
    assert.equal(book.chapters[0].title,'The Sample Book');
    assert.equal(book.chapters[0].text,'The complete story.');
  }
});

test('title separators and unrelated names do not cause false title suppression', () => {
  for(const title of ['Unknown Person - The Sample Book','The Sample Book - Another Journey']) {
    const book=parseEpub(authorSortedBook({title,pages:{'story.html':page('<h2>The Sample Book</h2><p>Some content.</p>')}}));
    assert.equal(book.navigation.status,'uncertain');
    assert.equal(book.navigation.candidates[0].title,'The Sample Book');
  }
});

test('explicit chapter semantics still preserve a chapter named after the author-prefixed book title', () => {
  const book=parseEpub(authorSortedBook({title:'Author, Sample - The Sample Book',pages:{
    'story.html':page('<section epub:type="chapter"><h1>The Sample Book</h1><p>The story.</p></section>')
  }}));
  assert.equal(book.navigation.status,'chapters');
  assert.equal(book.chapters[0].title,'The Sample Book');
});
