const test=require('node:test');
const assert=require('node:assert/strict');
const AdmZip=require('adm-zip');
const {makeBook,page,nav,ncx}=require('./epubNavigationFixture');
const {parseEpub}=require('../services/epubParser');
const {generateAiDirectory,needsAiDirectory}=require('../services/epubAiDirectory');
const {prepareParagraphs}=require('../services/paragraphSplitter');
const compact=s=>s.replace(/\s+/g,' ').trim();

test('visible directory entries own their complete opening up to the next listed section',()=>{
 const pages={
  'part.html':page('<h1>BOOK II</h1><h1>On Reading</h1><p>Part introduction.</p>'),
  'chapter.html':page('<h1>CHAPTER 3<br/><img src="line.png"/></h1><h1>The Cat</h1><p><em>Opening blurb.</em></p><p>The first paragraph.</p><h2>A local heading</h2><p>Still the same opening.</p>'),
  'continued.html':page('<p>Before the subsection.</p><h2 id="s">The Complex</h2><p>Next section.</p>')
 };
 const items=[['Book II: On Reading','part.html'],['Chapter 3. The Cat','chapter.html'],['The Complex','continued.html#s']];
 const book=parseEpub(makeBook({pages,nav:nav(items),extra:{'line.png':Buffer.from([1,2,3])}}));
 assert.equal(book.chapters[1].text,'CHAPTER 3\nThe Cat\nOpening blurb.\nThe first paragraph.\nA local heading\nStill the same opening.\nBefore the subsection.');
 assert.match(book.chapters[1].original.html,/<em>Opening blurb\.<\/em>/);
 assert.equal(book.chapters[1].images.length,1);
 assert.equal(book.chapters[2].text,'The Complex\nNext section.');
 assert.equal(book.chapters.map(c=>c.text).join('\n'),book.documents.map(d=>d.text).join('\n'));
 assert.deepEqual(book.navigation.coverage.uncovered,[]);
});

test('matching adjacent headings and case variants at the same target do not invalidate an original directory',()=>{
 const entries=[['Book I: The Start','one.html'],['Book II: The End','two.html']];
 const book=parseEpub(makeBook({pages:{
   'one.html':page('<h1>BOOK I</h1><h1>The Start</h1><p>A reference.</p><h2>Book II: The End</h2><p>More.</p>'),
   'two.html':page('<h1>BOOK II</h1><h1>The End<a href="#fn"><sup>1</sup></a></h1><p id="fn">Last line.</p>')
 },nav:nav(entries),ncx:ncx(entries.map(([title,path])=>[title.toUpperCase(),path]))}));
 assert.equal(book.navigation.status,'chapters');
 assert.equal(needsAiDirectory(book),false);
 assert.match(book.chapters[1].text,/The End1/);
});

test('an alternate TOC pointing at the subtitle cannot shorten a visible chapter either',()=>{
 const pages={'ch.html':page('<h1 id="n">CHAPTER 3</h1><h1 id="t">The Cat</h1><p>Opening words.</p><h2 id="s">The Complex</h2><p>Next.</p>')};
 const title='Chapter 3. The Cat';
 const primary=[[title,'ch.html#n'],['The Complex','ch.html#s']];
 const alternate=[[title,'ch.html#t'],['The Complex','ch.html#s']];
 const book=parseEpub(makeBook({pages,nav:nav(primary),ncx:ncx(alternate)}));
 assert.equal(book.chapters[0].text,'CHAPTER 3\nThe Cat\nOpening words.');
 assert.deepEqual(book.navigation.coverage.uncovered,[]);
});

test('linked unlisted end material is readable in directory order, and original contents remain in full reading',()=>{
 const book=parseEpub(makeBook({pages:{
   'toc.html':page('<h1>Original contents</h1><a href="chapter.html">First</a>'),
   'chapter.html':page('<h1>First</h1><p>See <a href="plates.html#plate">figure</a>.</p>'),
   'plates.html':page('<p id="plate">Original caption.</p>')
 },guide:'<reference type="toc" href="toc.html"/>'}));
 assert.equal(book.chapters[0].text,'First\nSee figure.');
 assert.equal(book.chapters[1]?.text,'Original caption.');
 assert.equal(book.navigation.status,'chapters');
 assert.equal(book.readingItems.map(d=>d.text).join('\n'),'Original contents\nFirst\nFirst\nSee figure.\nOriginal caption.');
});

test('every import checks text coverage and exposes source HTML absent from the declared reading order',()=>{
 const source=makeBook({pages:{'story.html':page('<h1>Chapter One</h1><p>A &copy; symbol and the last words.</p>')},
  nav:nav([['Chapter One','story.html']]),extra:{'unlisted.xhtml':page('<p>Unique omitted introduction.</p>')}});
 const book=parseEpub(source);
 assert.equal(book.integrity?.status,'verified');
 assert.equal(book.integrity.files,3);
 const extra=book.readingItems.find(item=>item.path==='OPS/unlisted.xhtml');
 assert.match(extra?.text||'',/Unique omitted introduction/);
 assert.equal(extra.kind,'unlisted');
 assert.match(book.chapters[0].text,/©/);
 assert.equal(book.navigation.status,'chapters');
});

test('unlisted introduction and afterword cannot be reported as a complete chapter directory',()=>{
 const source=makeBook({pages:{
  'intro.html':page('<h1>Introduction</h1><p>Unique opening words.</p>').replace('<body>','<body epub:type="frontmatter">'),
  'body.html':page('<h1 id="c">Chapter One</h1><p>Story words.</p>'),
  'end.html':page('<h1>Afterword</h1><p>Unique closing words.</p>').replace('<body>','<body epub:type="backmatter">')
 },nav:nav([['Chapter One','body.html#c']])});
 const book=parseEpub(source);assert.equal(needsAiDirectory(book),true);
 assert.match(book.readingItems.map(d=>d.text).join(' '),/Unique opening words/);
 assert.match(book.readingItems.map(d=>d.text).join(' '),/Unique closing words/);
});
test('a file containing both contents and prose retains the prose through repair',async()=>{
 const source=makeBook({pages:{'mixed.html':page('<h1>Introduction</h1><p>DO NOT LOSE THIS INTRODUCTION.</p><nav epub:type="toc" id="toc"><ol><li><a href="body.html">Chapter One</a></li></ol></nav><p>DO NOT LOSE THIS CONTINUATION.</p>'),'body.html':page('<h1>Chapter One</h1><p>Final words.</p>')},guide:'<reference type="toc" href="mixed.html#toc"/>'});
 const book=parseEpub(source);assert.match(book.readingItems.map(d=>d.text).join(' '),/DO NOT LOSE THIS INTRODUCTION/);
 const result=await generateAiDirectory(source,{callModel:async(system,prompt)=>{const units=JSON.parse(prompt).paragraphs;return JSON.stringify({sections:[{start:0},{start:units.find(u=>u.text==='Final words.').id}]});}});
 assert.match(result.book.chapters.map(c=>c.text).join(' '),/DO NOT LOSE THIS CONTINUATION/);
});
test('missing spine resources and manifest references stop parsing instead of silently skipping text',()=>{
 for(const mutate of [zip=>zip.updateFile('OPS/book.opf',Buffer.from(zip.readAsText('OPS/book.opf').replace('</spine>','<itemref idref="absent"/></spine>'))),zip=>zip.updateFile('OPS/book.opf',Buffer.from(zip.readAsText('OPS/book.opf').replace('href="body.html"','href="missing.html"')))]){
  const zip=new AdmZip(makeBook({pages:{'body.html':page('<p>Some text.</p>')}}));mutate(zip);
  assert.throws(()=>parseEpub(zip.toBuffer()),/EPUB.*(?:缺失|无法读取|找不到)/);
 }
});
test('unsupported content encoding is rejected instead of replacing original letters',()=>{
 const zip=new AdmZip(makeBook({pages:{'body.html':page('<p>Café.</p>')}}));
 zip.updateFile('OPS/body.html',Buffer.from(page('<p>Café.</p>'),'latin1'));
 assert.throws(()=>parseEpub(zip.toBuffer()),/EPUB.*编码/);
});
test('repair covers front/back matter, cross-file continuations, notes, repeated text and paragraph splitting',async()=>{
 const pages={
  'intro.html':page('<h1>Introduction</h1><p>FIRST WORDS: naïve café &amp; tea.</p>').replace('<body>','<body epub:type="frontmatter">'),
  'body.html':page('<h1>Chapter One</h1><p>Repeated words.</p><p>Repeated words.</p>'),
  'continuation.html':page('<p>CONTINUED across a file.</p><aside><p>FOOTNOTE text.</p></aside>'),
  'end.html':page('<h1>Afterword</h1><p>LAST WORDS — 中文。</p>').replace('<body>','<body epub:type="backmatter">')};
 const source=makeBook({pages});
 const expected='Introduction FIRST WORDS: naïve café & tea. Chapter One Repeated words. Repeated words. CONTINUED across a file. FOOTNOTE text. Afterword LAST WORDS — 中文。';
 const result=await generateAiDirectory(source,{callModel:async()=>JSON.stringify({sections:[{start:0,title:'Introduction',kind:'introduction'},{start:2,title:'Chapter One',kind:'chapter'},{start:7,title:'Afterword',kind:'afterword'}]})});
 assert.equal(compact(result.book.chapters.map(c=>c.text).join(' ')),expected);
 const segmented=await prepareParagraphs(result.book.chapters.map(c=>c.text).join('\n\n'),{mode:'preserve'});
 assert.equal(compact(segmented.text),expected);
 // Independent archive comparison: only empty anchors may be added to original content files.
 const originalZip=new AdmZip(source),repairedZip=new AdmZip(result.buffer);
 for(const file of Object.keys(pages))assert.equal(repairedZip.readAsText('OPS/'+file).replace(/<span id="study-ai-[^"]+"><\/span>/g,''),originalZip.readAsText('OPS/'+file));
});
