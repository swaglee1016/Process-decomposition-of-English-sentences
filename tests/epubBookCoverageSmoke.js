// Local acceptance for the reported Antifragile edition. Pass its EPUB path
// and, optionally, the standalone original-text HTML. No book is committed.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const AdmZip = require('adm-zip');
const {DOMParser} = require('@xmldom/xmldom');
const {createApp} = require('../server');
const {openBrowser} = require('./browserHarness');

const normalize = text => text.replace(/\s+/g,' ').trim();
const xml = bytes => new DOMParser().parseFromString(bytes.toString('utf8'),'application/xml');

// Derive the baseline from the package and source XML, independent of the
// application's HTML extraction, navigation, chapter ranges and preview.
function sourceBook(filename) {
  const zip = new AdmZip(filename);
  const opfPath = xml(zip.readFile('META-INF/container.xml')).getElementsByTagName('rootfile')[0].getAttribute('full-path');
  const opf = xml(zip.readFile(opfPath));
  const files = new Map(Array.from(opf.getElementsByTagName('item'), node => [
    node.getAttribute('id'),path.posix.join(path.posix.dirname(opfPath),decodeURIComponent(node.getAttribute('href')))
  ]));
  function read(node) {
    if (node.nodeType===3 || node.nodeType===4) return node.nodeValue;
    if (node.nodeType!==1) return '';
    const inner = Array.from(node.childNodes,read).join('');
    return /^(br|img|div|p|h[1-6])$/.test(node.localName) ? ' '+inner+' ' : inner;
  }
  return Array.from(opf.getElementsByTagName('itemref'),ref=>{
    const file = files.get(ref.getAttribute('idref'));
    const body = xml(zip.readFile(file)).getElementsByTagName('body')[0];
    return {file,body,text:normalize(read(body)),read};
  });
}

async function main() {
  const source = path.resolve(process.argv[2]);
  const originals = sourceBook(source);
  const chapter = originals.find(d=>d.file.endsWith('_c03_r1.htm'));
  assert.ok(chapter,'Expected the reported edition with the c03 document');
  const opening = [];
  for (const node of chapter.body.childNodes) {
    if (node.nodeType===1 && node.getAttribute('id')==='sec005') break;
    opening.push(chapter.read(node));
  }
  const expected = normalize(opening.join(''));
  assert.match(expected,/Stress is knowledge/);
  assert.match(expected,/The bold conjecture made here/);
  assert.doesNotMatch(expected,/The Complex/i);
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(),'epub-source-coverage-'));
  let directoryCalls=0;
  const app = createApp({outputDir,delayMs:0,directoryModel:async()=>{directoryCalls++;throw new Error('Unexpected directory repair');},
    analyzeSentence:async text=>({sentenceType:'测试',translation:'测试译文',parts:[{text,role:'主句',translation:'测试译文'}]}),
    renderDiagram:async()=>({buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><text y="15">Test</text></svg>'),mimeType:'image/svg+xml'})});
  const server = app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base = 'http://127.0.0.1:'+server.address().port;
  let browser;
  const stop = async()=>{if(server.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
  try {
    browser = await openBrowser();
    const {evaluate,until,call} = browser;
    // DevTools network tracing duplicates large inline font payloads. This
    // check reads the DOM and HTTP responses directly.
    await call('Network.disable');
    await browser.navigate(base);
    await until(()=>evaluate('typeof onFileChosen==="function"'));
    const {root} = await call('DOM.getDocument');
    const {nodeId} = await call('DOM.querySelector',{nodeId:root.nodeId,selector:'#fileInput'});
    await call('DOM.setFileInputFiles',{nodeId,files:[source]});
    await until(()=>evaluate('!!epubBook&&!busy'),60000);
    console.log('Original EPUB imported.');
    const toc = await evaluate('epubBook');
    assert.equal(toc.aiDirectory.state,'not-needed');
    assert.equal(directoryCalls,0);
    assert.deepEqual(toc.navigation.coverage.uncovered,[]);
    assert.equal(await evaluate('!document.querySelector("#epubReadBtn").hidden'),true);
    const get = async payload=>{
      const response = await fetch(base+'/api/epub/chapter',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({bookId:toc.bookId,...payload})});
      const data = await response.json();assert.equal(response.status,200,data.error);return data;
    };
    const whole = await get({mode:'reading'});
    assert.equal(normalize(whole.text),normalize(originals.map(d=>d.text).join(' ')));
    assert.equal(whole.original.chapters.length,originals.length);
    console.log('Full reading matches source XML.');
    const item = toc.chapters.find(c=>c.title.startsWith('Chapter 3.'));
    assert.equal(item.words,expected.split(/\s+/).length);
    await evaluate(`[...document.querySelectorAll('.epub-chapter-open')].find(b=>b.textContent.startsWith('Chapter 3.')).click()`);
    await until(()=>evaluate('!!preview&&!busy'));
    const shown = await evaluate(`[...document.querySelectorAll('#previewContent p')].map(p=>[...p.childNodes].filter(n=>n.nodeType===3).map(n=>n.data).join(''))`);
    assert.equal(normalize(shown.join(' ')),expected);
    console.log('Visible chapter preview matches the source opening.');
    await evaluate('analyzeBtn.click()');
    await until(()=>evaluate('!busy&&!!outputUrl'),60000);
    const resultPath = await evaluate('outputUrl');
    assert.equal((await fetch(base+resultPath)).status,200);
    console.log('Generated chapter retrieved.');
    await stop();
    await call('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
    await browser.navigate(pathToFileURL(path.join(outputDir,path.basename(resultPath))).href);
    await until(()=>evaluate('document.querySelectorAll(".para-text").length>0'));
    assert.equal(normalize(await evaluate('[...document.querySelectorAll(".para-text")].map(p=>p.textContent).join(" ")')),expected);
    console.log('Saved chapter verified offline.');
    if(process.argv[3]){
      await browser.navigate(pathToFileURL(path.resolve(process.argv[3])).href);
      await until(()=>evaluate('document.readyState==="complete"&&!!document.querySelector("main>section[data-source]")'));
      const pages = await evaluate('[...document.querySelectorAll("main>section")].map(s=>[s.dataset.source,s.textContent])');
      assert.deepEqual(pages.map(([file,text])=>[file,normalize(text)]),originals.map(d=>[d.file,normalize(d.body.textContent)]));
      await evaluate('document.querySelector(".study-nav a:last-child").click()');
      assert.equal(await evaluate('document.querySelector(location.hash).dataset.source'),chapter.file);
    }
    console.log(JSON.stringify({status:'PASS',spine:originals.length,entries:toc.chapters.length,
      openingWords:item.words,paragraphs:shown.length,images:item.images,modelDirectoryCalls:directoryCalls,offline:true}));
  } finally {await stop();await browser?.close();app.locals.closeVocabulary();}
}
main().catch(error=>{console.error(error.message.slice(0,1800));process.exitCode=1;});
