const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const AdmZip=require('adm-zip');
const {makeBook,page,nav,ncx}=require('./epubNavigationFixture');
const {parseEpub}=require('../services/epubParser');
const {needsAiDirectory,prepareDirectoryInput,generateAiDirectory,createDirectoryService}=require('../services/epubAiDirectory');

function inputBook(extra={}) {
  return makeBook({pages:{
    'opening.html':page('<p>Alpha <em>waited</em> by the sea.</p><p>Then Alpha sailed away.</p>'),
    'continuation.html':page('<p>Beta found the harbour.</p><p>The story ended.</p>')
  },...extra});
}
const model=async(system,prompt)=>{
  assert.match(system,/JSON/);
  assert.match(prompt,/Alpha/);
  return JSON.stringify({sections:[{start:0},{start:2}]});
};

test('automatic repair applies to missing, single-body and unreliable directories',()=>{
  assert.equal(needsAiDirectory(parseEpub(inputBook())),true);
  assert.equal(needsAiDirectory(parseEpub(inputBook({ncx:ncx([['Sample Book','opening.html']])}))),true,
    'an uncertain partly-covered original directory needs repair');
  const normal=makeBook({pages:{'book.html':page('<h1 id="a">First</h1><p>One.</p><h1 id="b">Second</h1><p>Two.</p>')},nav:nav([['First','book.html#a'],['Second','book.html#b']])});
  assert.equal(needsAiDirectory(parseEpub(normal)),false);
  const broken=inputBook({ncx:'<bad>'});
  assert.equal(needsAiDirectory(parseEpub(broken)),true);
});

test('AI sections round-trip through real EPUB navigation without rewriting any text or images',async()=>{
  const source=inputBook();
  const original=Buffer.from(source);
  const input=prepareDirectoryInput(source,parseEpub(source));
  assert.deepEqual(input.units.map(u=>u.id),[0,1,2,3]);
  const result=await generateAiDirectory(source,{callModel:model});
  assert.deepEqual(source,original);
  const book=parseEpub(result.buffer);
  assert.equal(book.navigation.status,'ai-generated');
  assert.deepEqual(book.chapters.map(c=>c.title),['Section 1','Section 2']);
  assert.equal(book.chapters[0].text,'Alpha waited by the sea.\nThen Alpha sailed away.');
  assert.equal(book.chapters[1].text,'Beta found the harbour.\nThe story ended.');
  assert.match(book.chapters[0].original.html,/<em>waited<\/em>/);
  assert.equal(needsAiDirectory(book),false);
  const zip=new AdmZip(result.buffer),first=zip.getEntries()[0];
  assert.equal(first.entryName,'mimetype');
  assert.equal(first.header.method,0);
  assert.equal(zip.readAsText('mimetype'),'application/epub+zip');
  assert.match(zip.readAsText('OPS/book.opf'),/sentence-process:ai-directory/);
  for(const item of book.chapters)assert.ok(item.evidence.fragment);
});

test('original directories stay in the archive and generated NCX and HTML targets agree',async()=>{
  const source=makeBook({pages:{
    'story_split_0.html':page('<p>Alpha waited.</p><p>Then Alpha left.</p>'),
    'story_split_1.html':page('<p>Beta returned.</p><p>All ended.</p>'),
    'toc.html':page('<a href="story_split_0.html">Sample Book</a>')
  },ncx:ncx([['Sample Book','story_split_0.html']]),guide:'<reference type="toc" href="toc.html"/>'});
  const result=await generateAiDirectory(source,{callModel:model});
  const zip=new AdmZip(result.buffer),old=new AdmZip(source),book=parseEpub(result.buffer);
  assert.equal(zip.readAsText('OPS/toc.html'),old.readAsText('OPS/toc.html'));
  assert.equal(zip.readAsText('OPS/toc.ncx'),old.readAsText('OPS/toc.ncx'));
  assert.equal(book.chapters.length,2);
  assert.equal(book.navigation.candidates.length,0);
  assert.doesNotMatch(book.chapters.map(c=>c.text).join('\n'),/Sample Book/);
  assert.deepEqual(book.navigation.warnings,[]);
});

test('invalid model boundaries, duplicated IDs and injected titles cannot become published directories',async()=>{
  for(const sections of [
    [{start:99}],
    [{start:1}],
    [{start:0},{start:0}],
    [{start:0},{start:-1}],
    [{title:'<script>x</script>',start:0},{title:'b',start:2}]
  ]) {
    await assert.rejects(generateAiDirectory(inputBook(),{callModel:async()=>JSON.stringify({sections}),repairAttempts:0}),/目录|标题|位置/);
  }
});

test('unreadable source archives never call the model',async()=>{
  let calls=0;
  await assert.rejects(generateAiDirectory(Buffer.from('not an EPUB'),{callModel:async()=>{calls++;return '{}';}}));
  assert.equal(calls,0);
});

test('content cache survives service recreation and simultaneous requests share one generation',async()=>{
  const outputDir=await fs.mkdtemp(path.join(os.tmpdir(),'epub-ai-cache-'));
  let calls=0;
  const service=createDirectoryService({outputDir,callModel:async(...args)=>{calls++;return model(...args);}});
  const source=inputBook();
  const [a,b]=await Promise.all([service.generate(source),service.generate(source)]);
  assert.equal(calls,1);assert.equal(a.filename,b.filename);
  const again=await createDirectoryService({outputDir,callModel:async()=>{throw new Error('must use cache');}}).cached(source);
  assert.equal(again.filename,a.filename);
  assert.equal(parseEpub(again.buffer).chapters.length,2);
});

test('generated EPUB2 uses real NCX and HTML anchors while preserving inline markup and resources',async()=>{
  const zip=new AdmZip(makeBook({pages:{'story.html':page('<p>Alpha &amp; <em>Beta</em> waited.</p><p>They left.</p><p>They came back.</p>')},
    ncx:ncx([['Sample Book','story.html']]),extra:{'picture.jpg':Buffer.from([1,2,3,4])}}));
  zip.updateFile('OPS/book.opf',Buffer.from(zip.readAsText('OPS/book.opf').replace('version="3.0"','version="2.0"')));
  const source=zip.toBuffer();
  const result=await generateAiDirectory(source,{callModel:async()=>JSON.stringify({sections:[{start:0},{start:2}]})});
  const exported=new AdmZip(result.buffer),book=parseEpub(result.buffer);
  assert.equal(book.navigation.source,'ncx');
  assert.equal(book.navigation.status,'ai-generated');
  assert.equal(book.chapters.map(c=>c.text).join('\n'),'Alpha & Beta waited.\nThey left.\nThey came back.');
  assert.deepEqual(exported.readFile('OPS/picture.jpg'),Buffer.from([1,2,3,4]));
  assert.match(exported.readAsText('OPS/story.html'),/&amp; <em>Beta<\/em>/);
  assert.match(exported.readAsText('OPS/book.opf'),/version="2.0"/);
  const tocFile=exported.getEntries().find(e=>/study-ai-.*\.xhtml$/.test(e.entryName));
  assert.doesNotMatch(tocFile.getData().toString(),/<(?:nav|aside)\b|epub:type=/);
  assert.match(tocFile.getData().toString(),/XHTML 1.1/);
  assert.equal(book.navigation.candidates.length,0);
});

test('long books use overlapping windows without forcing a chapter at every request boundary',async()=>{
  const prose=Array.from({length:36},(_,i)=>'<p>Paragraph '+i+'. '+'A long narrative continues. '.repeat(200)+'</p>').join('');
  const source=makeBook({pages:{'story.html':page(prose)}});
  let calls=0;
  const result=await generateAiDirectory(source,{callModel:async(system,prompt)=>{
    const data=JSON.parse(prompt);calls++;
    return JSON.stringify({sections:data.window===1?[{start:0},{start:10}]:[]});
  }});
  assert.ok(calls>1);
  assert.equal(result.book.chapters.length,2);
  assert.match(result.book.chapters[1].text,/Paragraph 35/);
});

test('exported navigation does not turn unsafe original guide targets into clickable links',async()=>{
  for(const target of ['javascript:alert(1)','https://foreign.invalid/toc','//foreign.invalid/toc','../../outside.html','..%2f..%2foutside.html']){
    const source=inputBook({guide:'<reference type="toc" href="'+target+'"/>'});
    const result=await generateAiDirectory(source,{callModel:model});
    const zip=new AdmZip(result.buffer);
    const generated=zip.getEntries().find(e=>/study-ai-.*\.xhtml$/.test(e.entryName));
    assert.ok(generated);
    assert.doesNotMatch(generated.getData().toString(),/javascript:|foreign\.invalid|outside\.html/);
  }
});

test('separate server instances publish one consistent directory without overwriting it',async()=>{
  const outputDir=await fs.mkdtemp(path.join(os.tmpdir(),'epub-ai-race-'));
  let count=0,release;const barrier=new Promise(resolve=>{release=resolve;});
  const service=label=>createDirectoryService({outputDir,callModel:async()=>{if(++count===2)release();await barrier;return JSON.stringify({sections:[{start:0},{start:label==='甲'?2:1}]});}});
  const source=inputBook(),results=await Promise.allSettled([service('甲').generate(source),service('乙').generate(source)]);
  assert.ok(results.every(r=>r.status==='fulfilled'),'both callers must receive the committed winner');
  const [a,b]=results.map(r=>r.value);
  assert.deepEqual(a.book.chapters.map(c=>c.text),b.book.chapters.map(c=>c.text));
  const saved=parseEpub(await fs.readFile(path.join(outputDir,a.filename)));
  assert.deepEqual(saved.chapters.map(c=>c.text),a.book.chapters.map(c=>c.text));
});

test('model output contains only boundaries and exported labels never summarize or translate the text',async()=>{
  const result=await generateAiDirectory(inputBook(),{callModel:async()=>JSON.stringify({sections:[{start:0},{start:2}]})});
  assert.deepEqual(result.book.chapters.map(c=>c.title),['Section 1','Section 2']);
  const zip=new AdmZip(result.buffer);
  const directory=zip.getEntries().find(e=>/study-ai-.*\.xhtml$/.test(e.entryName)).getData().toString();
  assert.match(directory,/>Section 1<\/a>/);
  assert.doesNotMatch(directory,/学习 1|准备出海|抵达港口/);
  await assert.rejects(generateAiDirectory(inputBook(),{callModel:async()=>JSON.stringify({sections:[{start:0,title:'A plot summary'},{start:2}]}),repairAttempts:0}),/目录/);
});

test('real original English Contents titles are preserved exactly',()=>{
  const titles=['I. The Beginning','II — Across the Sea'];
  const source=makeBook({pages:{'story.html':page('<h1 id="a">I. The Beginning</h1><p>Alpha.</p><h1 id="b">II — Across the Sea</h1><p>Beta.</p>')},nav:nav([[titles[0],'story.html#a'],[titles[1],'story.html#b']])});
  const book=parseEpub(source);
  assert.equal(needsAiDirectory(book),false);
  assert.deepEqual(book.chapters.map(c=>c.title),titles);
});

test('legacy cached splits cannot substitute for structural repair and imported artifacts remain untouched',async()=>{
  const source=makeBook({guide:'<reference type="toc" href="original.html"/>',pages:{
    'story.html':page('<p>Alpha waited.</p><p>Alpha sailed.</p><p>Beta returned.</p><p>The end.</p>'),
    'original.html':page('<a href="story.html">Sample Book</a>')
  }});
  const result=await generateAiDirectory(source,{callModel:model});
  const zip=new AdmZip(result.buffer);
  for(const entry of zip.getEntries().filter(e=>/study-ai-.*\.(xhtml|ncx)$/.test(e.entryName))){
    zip.updateFile(entry.entryName,Buffer.from(entry.getData().toString().replaceAll('Section 1','学习 1：老渔夫日常').replaceAll('Section 2','学习 2：男孩归来')));
  }
  const legacy=zip.toBuffer(),original=Buffer.from(legacy);
  const outputDir=await fs.mkdtemp(path.join(os.tmpdir(),'epub-ai-legacy-'));
  const hash=require('node:crypto').createHash('sha256').update(source).digest('hex');
  const legacyPath=path.join(outputDir,'ai-directory-v2-'+hash+'.epub');
  await fs.writeFile(legacyPath,legacy);
  let calls=0;
  const service=createDirectoryService({outputDir,callModel:async()=>{calls++;throw new Error('must not call model');}});
  for(const buffer of [source,legacy]){
    assert.equal(await service.cached(buffer),null);
  }
  assert.equal(calls,0);
  assert.deepEqual(await fs.readFile(legacyPath),original);
  assert.deepEqual(legacy,original);
});

test('an arbitrary AI metadata flag never authorizes rewriting an original English directory',async()=>{
  const entries=[['I. Beginning','story.html#a'],['II. Home','story.html#b']];
  const toc='<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Original Contents</title></head><body><h1>Original Contents</h1><p>Original introduction.</p><nav epub:type="toc"><ol>'+entries.map(([title,target])=>'<li><a href="'+target+'">'+title+'</a></li>').join('')+'</ol></nav></body></html>';
  const zip=new AdmZip(makeBook({pages:{'story.html':page('<h1 id="a">I. Beginning</h1><p>One.</p><h1 id="b">II. Home</h1><p>Two.</p>')},nav:toc,ncx:ncx(entries)}));
  zip.updateFile('OPS/book.opf',Buffer.from(zip.readAsText('OPS/book.opf').replace('</metadata>','<meta name="sentence-process:ai-directory" content="1"/></metadata>')));
  const source=zip.toBuffer();
  const outputDir=await fs.mkdtemp(path.join(os.tmpdir(),'epub-ai-marked-original-'));
  const service=createDirectoryService({outputDir,callModel:async()=>{throw new Error('must not call model');}});
  assert.equal(await service.cached(source),null);
  assert.deepEqual(await fs.readdir(outputDir),[]);
  assert.deepEqual(parseEpub(source).chapters.map(c=>c.title),entries.map(e=>e[0]));
});
