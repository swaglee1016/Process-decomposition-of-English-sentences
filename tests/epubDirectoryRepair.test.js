const test=require('node:test');
const assert=require('node:assert/strict');
const {makeBook,page,nav}=require('./epubNavigationFixture');
const {parseEpub}=require('../services/epubParser');
const {needsAiDirectory,generateAiDirectory}=require('../services/epubAiDirectory');

function fixture(){return makeBook({pages:{'book.html':page('<h1>Introducción</h1><p>Opening words.</p><h1>LIBRO I</h1><p>Part opening.</p><h2>I. CÓMO AMAR EL VIENTO</h2><p>Chapter one.</p><h2>II. Lo antifrágil</h2><p>Chapter two.</p><h1>Sobre el autor</h1><p>Author biography.</p>')},nav:nav([['Introducción','book.html#broken']])});}
const sections=[{start:0,title:'Introducción',depth:0,kind:'introduction'},{start:2,title:'LIBRO I',depth:0,kind:'part'},{start:4,title:'I. CÓMO AMAR EL VIENTO',depth:1,kind:'chapter'},{start:6,title:'II. Lo antifrágil',depth:1,kind:'chapter'},{start:8,title:'Sobre el autor',depth:0,kind:'author'}];
test('broken navigation invokes structural repair and preserves original multilingual titles and hierarchy',async()=>{
 const source=fixture(),before=parseEpub(source);
 assert.equal(needsAiDirectory(before),true);
 const result=await generateAiDirectory(source,{callModel:async(system,prompt)=>{
   const data=JSON.parse(prompt);
   assert.match(system,/原书/);assert.match(system,/引言/);
   assert.ok(data.originalDirectory.entries.some(e=>e.href==='book.html#broken'));assert.ok(data.paragraphs.some(p=>p.tag==='h2'));
   return JSON.stringify({sections});
 }});
 assert.deepEqual(result.book.chapters.map(c=>c.title),sections.map(s=>s.title));
 assert.deepEqual(result.book.chapters.map(c=>c.depth),[0,0,1,1,0]);
 assert.deepEqual(result.book.chapters.map(c=>c.kind),sections.map(s=>s.kind));
 assert.equal(result.book.navigation.repaired,true);
 assert.equal(result.book.chapters.map(c=>c.text).join('\n'),before.documents[0].text);
 assert.equal(needsAiDirectory(parseEpub(result.buffer)),false);
});
test('repair rejects invented labels and invalid hierarchy without publishing',async()=>{
 for(const bad of [sections.map((s,i)=>i===0?{...s,title:'Invented summary'}:s),sections.map((s,i)=>i===2?{...s,depth:5}:s)]){
   await assert.rejects(generateAiDirectory(fixture(),{repairAttempts:0,callModel:async()=>JSON.stringify({sections:bad})}),/AI 目录/);
 }
});
test('healthy original introduction and chapters bypass the model',async()=>{
 const source=makeBook({pages:{'book.html':page('<h1 id="intro">Introduction</h1><p>Intro.</p><h1 id="one">Chapter 1</h1><p>Story.</p>')},nav:nav([['Introduction','book.html#intro'],['Chapter 1','book.html#one']])});
 assert.equal(needsAiDirectory(parseEpub(source)),false);
 let calls=0;await assert.rejects(generateAiDirectory(source,{callModel:async()=>{calls++;return '{}';}}));assert.equal(calls,0);
});
test('parent groups sharing a child boundary do not duplicate its text',async()=>{
 const source=makeBook({pages:{'book.html':page('<h1>PART ONE</h1><h2>Chapter One</h2><p>A story.</p><h2>Chapter Two</h2><p>Another story.</p>')},nav:nav([['PART ONE','book.html#missing']])});
 const result=await generateAiDirectory(source,{callModel:async()=>JSON.stringify({sections:[{start:0,title:'PART ONE',depth:0,kind:'part'},{start:0,title:'Chapter One',depth:1,kind:'chapter'},{start:3,title:'Chapter Two',depth:1,kind:'chapter'}]})});
 assert.equal(result.book.chapters[0].group,true);
 assert.equal(result.book.chapters[0].text,'');
 assert.equal(result.book.chapters.map(c=>c.text).filter(Boolean).join('\n'),parseEpub(source).documents[0].text);
});
test('repair preserves a leading illustration and original heading element',async()=>{
 const source=makeBook({pages:{'book.html':page('<img src="image.png"/><h1>Introduction</h1><p>Opening.</p><h1>Chapter A</h1><p>Story.</p>')},extra:{'image.png':Buffer.from([1,2,3])}});
 const result=await generateAiDirectory(source,{callModel:async()=>JSON.stringify({sections:[{start:0,title:'Introduction',depth:0,kind:'introduction'},{start:2,title:'Chapter A',depth:0,kind:'chapter'}]})});
 assert.equal(result.book.chapters[0].images.length,1);
 assert.match(result.book.chapters[0].original.html,/<h1>Introduction<\/h1>/);
});
test('oversized original directory evidence fails before incurring a model call',async()=>{
 const source=makeBook({pages:{'book.html':page('<p>Opening words.</p><p>Closing words.</p>')},nav:nav([['A'.repeat(200000),'book.html#missing']])});
 let calls=0;await assert.rejects(generateAiDirectory(source,{callModel:async()=>{calls++;return '{}';}}),/EPUB 原目录/);assert.equal(calls,0);
});
test('swapped original chapter links are treated as unreliable, even when all text is covered',()=>{
 const source=makeBook({pages:{'book.html':page('<h1 id="one">Chapter One</h1><p>One.</p><h1 id="two">Chapter Two</h1><p>Two.</p>')},nav:nav([['Chapter One','book.html#two'],['Chapter Two','book.html#one']])});
 assert.equal(needsAiDirectory(parseEpub(source)),true);
});
