const test=require('node:test'),assert=require('node:assert/strict');
const {makeBook,page,nav}=require('./epubNavigationFixture');
const {generateAiDirectory}=require('../services/epubAiDirectory');
const normal=s=>s.replace(/\s+/g,' ').trim();
test('a million-character book uses all heading evidence and preserves unsent prose',async()=>{
 const pages={};for(let i=0;i<18;i++)pages['part'+i+'.html']=page('<h1>Part '+i+'</h1>'+Array.from({length:12},(_,j)=>'<p>Body '+i+'/'+j+' '+('Long prose remains in the book. '.repeat(190))+'</p>').join(''));
 const source=makeBook({pages});let calls=0,sent=0;const seen=new Set();
 const result=await generateAiDirectory(source,{callModel:async(system,prompt)=>{
  const data=JSON.parse(prompt);calls++;sent+=prompt.length;assert.ok(prompt.length<=160000);
  assert.equal(data.contextMode,'structure');
  const sections=data.paragraphs.filter(p=>p.tag==='h1').map(p=>{seen.add(p.text);return {start:p.id,title:p.text,depth:0,kind:'part'};});
  return JSON.stringify({sections});
 }});
 assert.equal(seen.size,18);assert.equal(result.book.chapters.length,18);assert.ok(sent<300000,'structural inspection should not send the whole book');
 assert.ok(calls>0);assert.match(result.book.chapters.at(-1).text,/Body 17\/11/);
 assert.equal(normal(result.book.chapters.map(c=>c.text).join(' ')),normal(Object.values(pages).map(s=>s.replace(/<head>[\s\S]*?<\/head>/,'').replace(/<[^>]*>/g,' ')).join(' ')));
});
test('plain paragraph chapter titles between formal headings are inspected',async()=>{
 const chunks=Array.from({length:100},(_,i)=>'<p>'+('Long narrative. '.repeat(420))+'</p>'+(i===49?'<p>CHAPTER TWO</p>':''));
 let found=false;
 const result=await generateAiDirectory(makeBook({pages:{'book.html':page('<h1>Introduction</h1>'+chunks.join('')+'<h1>Afterword</h1>')}}),{callModel:async(system,prompt)=>{
  const data=JSON.parse(prompt);return JSON.stringify({sections:data.paragraphs.filter(p=>p.tag==='h1'||p.text==='CHAPTER TWO').map(p=>{if(p.text==='CHAPTER TWO')found=true;return {start:p.id,title:p.text,depth:0};})});
 }});
 assert.ok(found);assert.deepEqual(result.book.chapters.map(c=>c.title),['Introduction','CHAPTER TWO','Afterword']);
});
test('overlapping batches retain hierarchy from before the overlap',async()=>{
 const headings=new Map([[0,['Part A',0]],[1,['Chapter A',1]],[2,['Section A',2]],[92,['Section B',2]],[94,['Part B',0]]]);
 const body=Array.from({length:100},(_,i)=>headings.has(i)?'<h'+(headings.get(i)[1]+1)+'>'+headings.get(i)[0]+'</h'+(headings.get(i)[1]+1)+'>':'<p>Prose '+i+'.</p>').join('');
 const result=await generateAiDirectory(makeBook({pages:{'book.html':page(body)}}),{callModel:async(system,prompt)=>JSON.stringify({sections:JSON.parse(prompt).paragraphs.filter(p=>headings.has(p.id)).map(p=>({start:p.id,title:p.text,depth:headings.get(p.id)[1]}))})});
 assert.equal(result.book.chapters.length,5);assert.deepEqual(result.book.chapters.map(c=>c.depth),[0,1,2,2,0]);
});
test('format retries count against the actual model call budget',async()=>{
 const body=Array.from({length:12000},(_,i)=>'<p>Prose '+i+'.</p>').join('');let calls=0;
 await assert.rejects(generateAiDirectory(makeBook({pages:{'book.html':page(body)}}),{callModel:async(system,prompt)=>{
  calls++;if(calls%2)return 'invalid';const data=JSON.parse(prompt.split('\n上次目录校验失败')[0]);return JSON.stringify({sections:data.window===1?[{start:0}]:[]});
 }}),/安全调用预算/);
 assert.equal(calls,256);
});
test('overlapping model results cannot assign conflicting depth or kind to the same title',async()=>{
 const body=Array.from({length:100},(_,i)=>i===0?'<h1>Introduction</h1>':i===92?'<h1>Chapter Two</h1>':'<p>Prose '+i+'.</p>').join('');
 for(const change of [{depth:1},{kind:'author'}])await assert.rejects(generateAiDirectory(makeBook({pages:{'book.html':page(body)}}),{callModel:async(system,prompt)=>{
  const data=JSON.parse(prompt);return JSON.stringify({sections:data.paragraphs.filter(p=>p.tag==='h1').map(p=>({start:p.id,title:p.text,depth:0,kind:'chapter',...(data.window>1?change:{})}))});
 }}),/冲突/);
});
test('more than 128 genuine chapters merge without losing the final chapter',async()=>{
 const body=Array.from({length:160},(_,i)=>'<h1>Chapter '+i+'</h1><p>'+('Narrative text. '.repeat(450))+'</p>').join('');
 const result=await generateAiDirectory(makeBook({pages:{'book.html':page(body)},nav:nav([['Chapter 0','book.html#missing']])}),{callModel:async(system,prompt)=>JSON.stringify({sections:JSON.parse(prompt).paragraphs.filter(p=>p.tag==='h1').map(p=>({start:p.id,title:p.text,depth:0}))})});
 assert.equal(result.book.chapters.length,160);assert.equal(result.book.chapters.at(-1).title,'Chapter 159');
});
test('a very long paragraph is sent in pieces without creating extra chapter boundaries',async()=>{
 const prose='Long uninterrupted paragraph. '.repeat(7000)+'FINAL MARKER.';const pieces=new Set();
 const result=await generateAiDirectory(makeBook({pages:{'book.html':page('<p>Beginning.</p><p>'+prose+'</p>')}}),{callModel:async(system,prompt)=>{
  const data=JSON.parse(prompt);for(const p of data.paragraphs)if(p.id===1)pieces.add(p.part);
  return JSON.stringify({sections:data.window===1?[{start:0}]:[]});
 }});
 assert.equal(pieces.size,Math.ceil(prose.length/40000));assert.equal(result.book.chapters.length,1);assert.match(result.book.chapters[0].text,/FINAL MARKER/);
});
test('unstructured long prose continues beyond eight batches without inventing batch chapters',async()=>{
 const paragraphs=Array.from({length:210},(_,i)=>'<p>Paragraph '+i+'. '+('Narrative text. '.repeat(420))+'</p>');
 let calls=0,maxId=-1;
 const result=await generateAiDirectory(makeBook({pages:{'book.html':page(paragraphs.join(''))}}),{callModel:async(system,prompt)=>{
  const data=JSON.parse(prompt);calls++;assert.ok(prompt.length<=160000);maxId=Math.max(maxId,...data.paragraphs.map(p=>p.id));
  return JSON.stringify({sections:data.window===1?[{start:0}]:[]});
 }});
 assert.ok(calls>8);assert.equal(maxId,209);assert.equal(result.book.chapters.length,1);assert.match(result.book.chapters[0].text,/Paragraph 209/);
});
test('structural evidence can request full context before producing the directory',async()=>{
 const prose=Array.from({length:20},(_,i)=>'<p>Evidence '+i+' '+('Detailed body text. '.repeat(3000))+'</p>').join('');
 let requested=false,detail=false;
 const result=await generateAiDirectory(makeBook({pages:{'book.html':page('<h1>Introduction</h1>'+prose+'<h1>Afterword</h1><p>The end.</p>')}}),{callModel:async(system,prompt)=>{
  const data=JSON.parse(prompt);assert.ok(prompt.length<=160000);
  if(data.contextMode==='structure'&&!requested){requested=true;return JSON.stringify({sections:[],needsContext:[1]});}
  if(data.contextMode==='detail'){detail=true;assert.match(prompt,/Detailed body text/);}
  return JSON.stringify({sections:data.paragraphs.filter(p=>p.tag==='h1').map(p=>({start:p.id,title:p.text,depth:0,kind:'other'}))});
 }});
 assert.ok(requested&&detail);assert.match(result.book.chapters.map(c=>c.text).join(' '),/Evidence 19/);
});
