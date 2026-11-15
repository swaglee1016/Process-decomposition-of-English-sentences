const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise application state and submitted payloads with a deterministic DOM.
// Actual checkbox activation/layout are covered separately in Chrome smoke tests.
class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase(); this.children = []; this.handlers = {};
    this.style = {}; this.attributes = {}; this.dataset = {}; this.value = '';
    this.files = []; this.hidden = false; this.disabled = false; this.textContent = '';
    const names = new Set();
    this.classList = {contains: name => names.has(name),
      add: name => names.add(name), remove: name => names.delete(name),
      toggle(name, force) { const enabled = force ?? !names.has(name); enabled ? names.add(name) : names.delete(name); return enabled; }};
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name]; }
  addEventListener(name, handler) { (this.handlers[name] ||= []).push(handler); }
  async dispatch(name, event = {}) { for (const handler of this.handlers[name] || []) await handler({target:this, stopPropagation(){}, preventDefault(){}, ...event}); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  querySelectorAll(selector) {
    const tags = selector.split(',').map(s => s.trim().toUpperCase());
    return this.children.flatMap(child => [ ...(tags.includes(child.tagName) ? [child] : []), ...child.querySelectorAll(selector) ]);
  }
  insertAdjacentHTML() {}
}

const toc = {bookId:'book-1', title:'Fixture Novel', chapters:[
  {id:'0',title:'Chapter One',depth:0,words:2},
  {id:'1',title:'Chapter Two',depth:0,words:2},
]};
const chapterText = ['Alpha arrived.', 'Beta left.'];
function harness({expired = false, invalidChapter = false, book = toc} = {}) {
  const elements = new Map();
  const element = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  element('fileInput').files = [new File(['epub fixture'], 'novel.epub')];
  const calls = [], submitted = [];
  let expireNext = expired;
  let rejectChapters = invalidChapter;
  let poll=()=>{};
  const context = vm.createContext({
    document:{getElementById:element, createElement:tag => new Element(tag), createTextNode:text => Object.assign(new Element('#text'), {textContent:text})},
    FormData, TextDecoder, Date, Set, JSON, console,setInterval:fn=>{poll=fn;return 1;},clearInterval:()=>{poll=()=>{};},
    StudyShared:require('../public/studyShared'), InlineDiagramCanvas:{mount(){}}, StudyNavigation:{mount(){}},
    EpubOriginal:{mount(){}}, Vocabulary:{mount(){}}, ReadingWorkspace:{mount(){},unmount(){}},
    window:{open(){}},
    fetch:async (url, options = {}) => {
      calls.push({url, options});
      const response = (data, status = 200) => ({ok:status === 200, status, json:async () => data});
      if (url === '/api/epub/toc') return response({...book, bookId:calls.length > 1 ? 'book-restored' : 'book-1'});
      if (url.startsWith('/api/epub/book/')) return response(book);
      if (url === '/api/epub/chapter') {
        const body = JSON.parse(options.body);
        if (expireNext) { expireNext = false; return response({error:'书籍会话已过期，请重新上传 EPUB 文件'},404); }
        if (rejectChapters) return response({error:'目录中没有这个章节，请重新上传 EPUB 文件'},404);
        const ids = body.ids || [body.id];
        if(body.mode==='reading')return response({title:'原书目录页',text:'Original contents page.',images:[]});
        return response({title:ids.length > 1 ? '2 个章节合并' : toc.chapters[Number(ids[0])].title,
          text:toc.chapters.filter(c => ids.includes(c.id)).map(c => chapterText[Number(c.id)]).join('\n\n'),images:[]});
      }
      if (url === '/api/preview') {
        const text = options.body.get('text');
        return response({text,warnings:[],sections:text.split('\n\n').map(paragraph => ({paragraph,sentences:[{text:paragraph,start:0,end:paragraph.length}]}))});
      }
      if (url === '/api/process') {
        submitted.push(options.body.get('text'));
        const stream = new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('event: complete\ndata: {"resultId":"test-result"}\n\n'));controller.close();}});
        return {ok:true,body:stream};
      }
      if (url.startsWith('/api/result/')) return response({sections:[],outputUrl:'/outputs/test.html',filename:'test.html'});
      throw new Error('Unexpected URL: '+url);
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8'),context);
  const run = expression => vm.runInContext(expression, context);
  return {element,run,calls,submitted,poll:()=>poll(),rejectChapters(){rejectChapters=true;}};
}

test('EPUB checkboxes are separate from single-chapter buttons and edits invalidate stale preview', async () => {
  const h = harness();
  await h.run('loadEpubToc(fileInput.files[0])');
  await h.run('loadChapters(["0"],"0")');
  const firstRow = h.element('epubToc').children[0];
  assert.notEqual(firstRow.tagName, 'BUTTON', 'checkbox must not be nested inside a chapter button');
  const checks = h.element('epubToc').querySelectorAll('input');
  for (const check of checks) {check.checked = true; await check.dispatch('change');}
  assert.equal(h.element('previewPanel').hidden,true,'old single-chapter preview must be invalidated');
  await h.run('loadSelectedChapters()');
  assert.equal(h.run('preview.sections.length'),2);
  await h.element('analyzeBtn').dispatch('click');
  assert.deepEqual(h.submitted,[chapterText.join('\n\n')]);
});

test('replacing a pasted article does not carry the prior result into the new draft',async()=>{
 const h=harness();
 h.element('leftContent').parentElement=h.element('sourcePanel');
 h.run('outputUrl="/outputs/sentence-decomposition-20261107-200000.html";selectedSentence="4";textInput.value="Different pasted article."');
 await h.element('textInput').dispatch('input');
 const state=h.run('captureWorkspace()');
 assert.equal(state.input.text,'Different pasted article.');
 assert.equal(state.resultFilename,null);
 assert.equal(state.selectedSentence,null);
});

test('refreshing chapter selection preserves collapsed TOC and preview has a working toggle', async () => {
  const h = harness();
  await h.run('loadEpubToc(fileInput.files[0])');
  h.run('setEpubCollapsed(true)');
  await h.run('loadChapters(["0"],"0")');
  assert.equal(h.element('epubPanel').classList.contains('collapsed'),true);
  assert.equal(h.element('previewToggle').getAttribute('aria-expanded'),'true');
  await h.element('previewToggle').dispatch('click');
  assert.equal(h.element('previewPanel').classList.contains('collapsed'),true);
  assert.equal(h.element('previewToggle').getAttribute('aria-expanded'),'false');
  await h.element('previewToggle').dispatch('click');
  assert.equal(h.element('previewPanel').classList.contains('collapsed'),false);
});

test('expired book sessions restore once using the retained EPUB and retry all selected chapters', async () => {
  const h = harness({expired:true});
  await h.run('loadEpubToc(fileInput.files[0])');
  h.run('selectedIds.add("0");selectedIds.add("1")');
  await h.run('loadSelectedChapters()');
  assert.equal(h.run('preview?.sections.length'),2);
  assert.equal(h.element('epubPanel').hidden,false);
  const uploads = h.calls.filter(c => c.url === '/api/epub/toc');
  assert.equal(uploads.length,2,'one automatic restoration upload');
  const loads = h.calls.filter(c => c.url === '/api/epub/chapter').map(c => JSON.parse(c.options.body));
  assert.deepEqual(loads.map(body => body.ids),[['0','1'],['0','1']]);
  assert.equal(loads[1].bookId,'book-restored');
  assert.equal(h.run('selectedIds.size'),2);
});

test('invalid chapter identifiers do not trigger upload loops or discard the directory', async () => {
  const h = harness({invalidChapter:true});
  await h.run('loadEpubToc(fileInput.files[0])');
  await h.run('loadChapters(["0"],"0")');
  assert.equal(h.calls.filter(c => c.url === '/api/epub/toc').length,1);
  assert.equal(h.element('epubPanel').hidden,false);
  assert.match(h.element('statusText').textContent,/没有这个章节/);
});

test('explicit single-chapter loading clears prior multi-selection', async () => {
  const h = harness();
  await h.run('loadEpubToc(fileInput.files[0])');
  h.run('selectedIds.add("0");selectedIds.add("1")');
  await h.run('loadSelectedChapters()');
  await h.run('selectChapter(epubBook.chapters[1])');
  assert.equal(h.run('selectedIds.size'),0,'selection count must reflect the explicit single-chapter action');
  assert.equal(h.run('preview.sections[0].paragraph'),chapterText[1]);
});

test('failed chapter loading cannot analyse stale text', async () => {
  const h = harness();
  await h.run('loadEpubToc(fileInput.files[0])');
  await h.run('loadChapters(["1"],"1")');
  h.rejectChapters();
  await h.run('loadChapters(["0"],"0")');
  assert.equal(h.element('analyzeBtn').disabled,true);
  assert.equal(h.element('previewPanel').hidden,true);
  await h.element('analyzeBtn').dispatch('click');
  assert.deepEqual(h.submitted,[],'failed chapter load must never submit previously loaded content');
});

test('missing navigation shows an empty state and independent reading preview, never file rows as chapters', async () => {
  const h = harness({book:{...toc,chapters:[],navigation:{status:'not-found',source:null,warnings:[],candidates:[]},
    reading:{words:27106,items:[{id:'document-0',title:'书内材料 1',words:8},{id:'document-1',title:'书内材料 2',words:27098}]}}});
  await h.run('loadEpubToc(fileInput.files[0])');
  assert.equal(h.element('epubTitle').textContent, '《Fixture Novel》章节目录');
  assert.match(h.element('epubHint').textContent, /未检出/);
  assert.equal(h.element('epubToc').querySelectorAll('input').length,0);
  assert.equal(h.element('loadSelectedBtn').hidden,true);
  assert.equal(h.element('epubReadBtn').hidden,false);
  assert.match(h.element('epubReadBtn').textContent,/阅读全文/);
  assert.doesNotMatch(h.element('epubHint').textContent,/原书没有/);
  await h.element('processBtn').dispatch('click');
  assert.match(h.element('statusText').textContent,/阅读全文/);
});

test('single body entry and uncertain candidates have distinct explanations', async () => {
  const h=harness({book:{...toc,chapters:[toc.chapters[0]],navigation:{status:'single-body-entry',source:'ncx',warnings:[],candidates:[]},reading:{words:27000,items:[]}}});
  await h.run('loadEpubToc(fileInput.files[0])');
  assert.match(h.element('epubHint').textContent,/一个正文入口/);
  h.run('epubBook.navigation={status:"uncertain",source:"nav",warnings:[{message:"目录可能不完整"}],candidates:[{id:"candidate-0",title:"Chapter Two",words:10}]};renderEpubToc()');
  assert.equal(h.element('epubCandidates').hidden,true);
  assert.match(h.element('epubWarnings').textContent,/目录可能不完整/);
  assert.equal(h.element('epubCandidates').querySelectorAll('button').length,0);
  h.run('epubBook.navigation.source="headings";renderEpubToc()');
  assert.match(h.element('epubHint').textContent,/来自正文章标题识别/);
});

test('eligible uploads automatically obtain an AI directory and expose a saved EPUB', async () => {
  const h=harness({book:{...toc,chapters:[],navigation:{status:'not-found',source:null,warnings:[],candidates:[]},reading:{words:4000,items:[]},aiDirectory:{state:'needed'}}});
  h.run('const oldFetch=fetch;fetch=async(url,options)=>url==="/api/epub/ai-directory"?{ok:true,json:async()=>({bookId:"book-1",title:"Fixture Novel",chapters:[{id:"0",title:"Section 1",words:2000},{id:"1",title:"Section 2",words:2000}],navigation:{status:"ai-generated",warnings:[],candidates:[]},aiDirectory:{state:"ready",downloadUrl:"/outputs/ai-test.epub"}})}:oldFetch(url,options)');
  await h.run('loadEpubToc(fileInput.files[0])');
  assert.equal(h.run('epubBook.navigation.status'),'ai-generated');
  assert.match(h.element('epubTitle').textContent,/AI/);
  assert.equal(h.element('epubAiDownload').hidden,false);
  assert.equal(h.element('epubAiDownload').getAttribute('href'),'/outputs/ai-test.epub');
  assert.equal(h.element('epubAiRetry').hidden,true);
});

test('failed automatic directory generation keeps the original book readable and offers explicit retry', async () => {
  const h=harness({book:{...toc,chapters:[],navigation:{status:'not-found',source:null,warnings:[],candidates:[]},reading:{words:4000,items:[]},aiDirectory:{state:'needed'}}});
  h.run('const oldFetch=fetch;fetch=async(url,options)=>url==="/api/epub/ai-directory"?{ok:false,json:async()=>({error:"AI 服务暂时不可用"})}:oldFetch(url,options)');
  await h.run('loadEpubToc(fileInput.files[0])');
  assert.equal(h.run('epubBook.navigation.status'),'not-found');
  assert.equal(h.element('epubAiRetry').hidden,false);
  assert.equal(h.element('epubReadBtn').hidden,false);
  assert.match(h.element('epubAiStatus').textContent,/暂时不可用/);
});


test('uncertain navigation does not expose candidate or material button grids', async () => {
  const h=harness({book:{...toc,navigation:{status:'uncertain',source:'nav',warnings:[],candidates:Array.from({length:200},(_,i)=>({id:'candidate-'+i,title:'Title '+i,words:100}))},reading:{words:20000,items:Array.from({length:200},(_,i)=>({id:'document-'+i,words:100}))}}});
  await h.run('loadEpubToc(fileInput.files[0])');
  assert.equal(h.element('epubCandidates').hidden,true);
  assert.equal(h.element('epubCandidates').children.length,0);
  assert.equal(h.element('epubMaterialList').children.length,0);
  assert.equal(h.element('epubMaterials').hidden,true);
  assert.equal(h.element('epubReadBtn').hidden,false);
});

test('repaired directory uses original titles and hides whole-book fallback', async () => {
  const h=harness({book:{...toc,chapters:[{id:'0',title:'Introducción',kind:'introduction',words:100},{id:'1',title:'Capítulo I',kind:'chapter',words:1000}],navigation:{status:'ai-generated',repaired:true,warnings:[],candidates:[]},reading:{words:1100,items:[]},aiDirectory:{state:'ready',downloadUrl:'/outputs/repaired.epub'}}});
  await h.run('loadEpubToc(fileInput.files[0])');
  assert.match(h.element('epubAiStatus').textContent,/修复/);
  assert.doesNotMatch(h.element('epubAiStatus').textContent,/Section/);
  assert.equal(h.element('epubToc').children[0].children[1].children[0].textContent,'Introducción');
  assert.equal(h.element('epubReading').hidden,true);
  assert.equal(h.element('epubAiDownload').getAttribute('href'),'/outputs/repaired.epub');
});
test('normal chapter directory still exposes unlisted title-page materials without candidate clutter',async()=>{
  const h=harness({book:{...toc,navigation:{status:'chapters',warnings:[],candidates:[],coverage:{uncovered:[{kind:'frontmatter',path:'title.html'}]}},reading:{words:1100,items:[]}}});
  await h.run('loadEpubToc(fileInput.files[0])');
  assert.equal(h.element('epubReading').hidden,false);
  assert.match(h.element('epubReadingHint').textContent,/未列入目录/);
  assert.equal(h.element('epubCandidates').hidden,true);
});

test('a healthy directory offers full reading and direct access to an original source page',async()=>{
  const h=harness({book:{...toc,navigation:{status:'chapters',warnings:[]},reading:{words:1000,items:[
    {id:'document-3',title:'原书目录页',words:100,separate:true}
  ]}}});
  await h.run('loadEpubToc(fileInput.files[0])');
  assert.equal(h.element('epubReading').hidden,false);
  assert.equal(h.element('epubMaterials').hidden,false);
  const [source]=h.element('epubMaterialList').querySelectorAll('button');
  assert.match(source.textContent,/原书目录页/);
  await source.dispatch('click');
  const request=h.calls.find(call=>call.url==='/api/epub/chapter');
  assert.equal(JSON.parse(request.options.body).id,'document-3');
  assert.equal(JSON.parse(request.options.body).mode,'reading');
  assert.equal(h.run('preview.sections[0].paragraph'),'Original contents page.');
});

test('refresh restores a saved book and edited preview without asking for its File again',async()=>{
 const h=harness();
 h.run('fileInput.files=[]');
 await h.run('restoreWorkspace({schema:1,input:{text:"",paragraphMode:"preserve"},bookId:"book-1",selection:{ids:["0"],activeId:"0",mode:"chapter",loadedIds:["0"]},preview:{text:"Alpha arrived. Edited boundary.",warnings:[]},layout:{epubCollapsed:true},scroll:{},jobId:""})');
 assert.equal(h.run('epubBook.bookId'),'book-1');
 assert.equal(h.run('preview.text'),'Alpha arrived. Edited boundary.');
 assert.equal(h.run('isEpubFile()'),true);
 assert.equal(h.run('selectedIds.has("0")'),true);
 assert.equal(h.element('epubPanel').classList.contains('collapsed'),true);
 assert.equal(h.calls.filter(c=>c.url==='/api/epub/toc').length,0);
});


test('failed repair remains retryable when the chapter directory is rendered again', async () => {
  const h=harness({book:{...toc,navigation:{status:'uncertain',source:'nav',warnings:[],candidates:[]},reading:{words:4000,items:[]},aiDirectory:{state:'needed'}}});
  h.run('const oldFetch=fetch;fetch=async(url,options)=>url==="/api/epub/ai-directory"?{ok:false,json:async()=>({error:"AI 服务暂时不可用"})}:oldFetch(url,options)');
  await h.run('loadEpubToc(fileInput.files[0])');
  h.run('renderEpubToc()');
  assert.equal(h.element('epubAiRetry').hidden,false);
  assert.equal(h.element('epubAiStatus').hidden,false);
  assert.match(h.element('epubAiStatus').textContent,/暂时不可用/);
  assert.equal(h.element('epubToc').querySelectorAll('button').length,2);
});
test('long repair shows batch progress and permanent errors do not invite identical retries',async()=>{
  const h=harness({book:{...toc,navigation:{status:'uncertain',warnings:[],candidates:[]},reading:{words:4000,items:[]},aiDirectory:{state:'needed'}}});
  h.run('let finishRepair;const oldFetch=fetch;fetch=async(url,options)=>url==="/api/epub/ai-directory"?new Promise(r=>finishRepair=r):url.includes("/ai-directory/status/")?{ok:true,json:async()=>({phase:"structure",current:2,total:12})}:oldFetch(url,options)');
  const pending=h.run('loadEpubToc(fileInput.files[0])');await new Promise(setImmediate);await h.poll();
  assert.match(h.element('epubAiStatus').textContent,/2.*12/);
  h.run('finishRepair({ok:false,json:async()=>({error:"EPUB 目录证据超过容量",retryable:false})})');await pending;
  assert.equal(h.element('epubAiRetry').hidden,true);h.run('renderEpubToc()');
  assert.doesNotMatch(h.element('epubHint').textContent,/将由 AI/);
  assert.doesNotMatch(h.element('epubAiStatus').textContent,/可以重试/);
});
