// node tests/epubOriginalBrowserSmoke.js
// Full UI/API smoke with synthetic analysis/SVGs; never calls a paid model.
// Retains generated output and Chrome profile. Offline phase stops the server.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const AdmZip = require('adm-zip');
const {createApp} = require('../server');
const {openBrowser} = require('./browserHarness');

function fixture() {
  const zip = new AdmZip();
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const files = {
    'META-INF/container.xml':'<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>',
    'OPS/book.opf':'<package><manifest><item id="nav" href="nav.xhtml" properties="nav"/><item id="a" href="a.xhtml"/><item id="b" href="b.xhtml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>',
    'OPS/nav.xhtml':'<nav epub:type="toc"><ol><li><a href="a.xhtml">First</a></li><li><a href="b.xhtml">Second</a></li></ol></nav>',
    'OPS/a.xhtml':'<html class="book-root" lang="en"><head><title>First</title><link rel="stylesheet" href="book.css"/></head><body class="novel"><h1>First</h1><p>She <em>waited</em>.</p><img src="scene.png"/><script>parent.compromised=true</script><iframe src="https://example.invalid/frame"></iframe><a href="https://example.invalid/leak"> </a><img src="https://example.invalid/image" onerror="parent.compromised=true"/><meta http-equiv="refresh" content="0;url=https://example.invalid/redirect"></body></html>',
    'OPS/b.xhtml':'<html><head><title>Second</title><link rel="stylesheet" href="second.css"/></head><body><h2>Second</h2><p>Rain fell.</p></body></html>',
    'OPS/book.css':'@font-face{font-family:FixtureBook;src:url(book.ttf)}html.book-root{background-color:rgb(255,255,240)}body.novel{margin:20px;font-family:FixtureBook}h1{font-size:38px;margin-top:90px;text-align:center}p{text-indent:24px}em{color:rgb(112,48,64);font-style:italic}body{background-image:url(https://example.invalid/css)}',
    'OPS/second.css':'h2{color:rgb(16,96,80)}',
    'OPS/scene.png':Buffer.from(png,'base64'),
    'OPS/book.ttf':fsSync.readFileSync(path.join(process.env.WINDIR || 'C:\\Windows','Fonts','georgia.ttf')),
  };
  for (const [name,content] of Object.entries(files)) zip.addFile(name,Buffer.from(content));
  return zip.toBuffer();
}
async function main() {
  const outputDir = path.resolve(__dirname,'../outputs');
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1000"><rect width="900" height="1000" fill="white"/><text x="20" y="60">Synthetic diagram</text></svg>');
  const app = createApp({outputDir,delayMs:0,analyzeSentence:async text=>({sentenceType:'简单句',translation:'合成验收译文',parts:[{text,role:'主句',translation:'合成译文'}]}),renderDiagram:async()=>({buffer:svg,mimeType:'image/svg+xml'})});
  const server = app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  let browser;
  async function stop(){if(server.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}}
  try {
    browser = await openBrowser();
    const {evaluate,until} = browser;
    await browser.navigate(`http://127.0.0.1:${server.address().port}`);
    await until(()=>evaluate('typeof loadEpubToc === "function"'));
    await evaluate(`(async()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(fixture().toString('base64'))}),c=>c.charCodeAt(0));const file=new File([bytes],'original-fixture.epub');const dt=new DataTransfer();dt.items.add(file);fileInput.files=dt.files;onFileChosen();})()`);
    await until(()=>evaluate('!!epubBook && !busy'));
    await evaluate('for(const check of document.querySelectorAll(".epub-check"))check.click();loadSelectedBtn.click();');
    await until(()=>evaluate('!!preview && !busy'));
    assert.equal(await evaluate('preview.sections.flatMap(s=>s.sentences).length'),4);
    await evaluate('analyzeBtn.click()');
    await until(()=>evaluate('!busy && statusText.textContent.startsWith("完成：")'));
    const filename = await evaluate('savePath.textContent.replace("已永久保存：outputs/","")');
    const savedPath = path.join(outputDir,filename);
    assert.match(await fs.readFile(savedPath,'utf8'),/epubOriginalData/);
    async function verifyView(offline) {
      await until(()=>evaluate('document.querySelectorAll(".sent-span").length===4'));
      await evaluate(`document.querySelector('#translationContent .translation-text[data-section="1"]').click();`);
      await until(()=>evaluate('!document.getElementById("readingModeToggle").disabled && document.querySelectorAll(".epub-original-frame").length===2'));
      await evaluate(`Promise.all([...document.querySelectorAll('.epub-original-frame')].map(frame=>frame.contentDocument.fonts.ready))`);
      await until(()=>evaluate(`[...document.querySelectorAll('.epub-original-frame')].every(frame=>frame.contentDocument.documentElement.scrollHeight<=frame.clientHeight+1)`));
      const state = await evaluate(`(() => {const frames=[...document.querySelectorAll('.epub-original-frame')],first=frames[0].contentDocument,second=frames[1].contentDocument;return {
        status:document.getElementById('readingModeStatus').textContent,labels:frames.flatMap(f=>[...f.contentDocument.querySelectorAll('.study-original-sentence')].map(s=>s.dataset.section)),
        highlights:frames.flatMap(f=>[...f.contentDocument.querySelectorAll('.study-selected')].map(s=>s.dataset.section)),
        italic:first.defaultView.getComputedStyle(first.querySelector('em')).fontStyle,color:first.defaultView.getComputedStyle(first.querySelector('em')).color,
        heading:first.defaultView.getComputedStyle(first.querySelector('h1')).textAlign,indent:first.defaultView.getComputedStyle(first.querySelector('p')).textIndent,
        secondColor:second.defaultView.getComputedStyle(second.querySelector('h2')).color,scriptNodes:first.querySelectorAll('script,iframe,meta[http-equiv=refresh]').length,
        image:first.querySelector('img').naturalWidth,sandbox:frames[0].getAttribute('sandbox'),compromised:!!window.compromised,
        rootColor:first.defaultView.getComputedStyle(first.documentElement).backgroundColor,fontStatus:[...first.fonts].find(face=>face.family==='FixtureBook')?.status,
        overflow:frames.map(f=>f.contentDocument.documentElement.scrollHeight-f.clientHeight)};})()`);
      assert.doesNotMatch(state.status,/未能/);
      assert.deepEqual([...new Set(state.labels)],['0','1','2','3']);
      assert.ok(state.highlights.length>=2&&state.highlights.every(id=>id==='1'),'sentence across em must retain one shared ID');
      assert.equal(state.italic,'italic');assert.equal(state.color,'rgb(112, 48, 64)');assert.equal(state.heading,'center');assert.equal(state.indent,'24px');
      assert.equal(state.secondColor,'rgb(16, 96, 80)');assert.equal(state.scriptNodes,0);assert.equal(state.compromised,false);assert.equal(state.sandbox,'allow-same-origin');
      assert.equal(state.rootColor,'rgb(255, 255, 240)');assert.equal(state.fontStatus,'loaded','embedded book font must load online and offline');
      await until(()=>evaluate('document.querySelector(".epub-original-frame").contentDocument.querySelector("img").naturalWidth===1'));
      assert.ok(state.overflow.every(delta=>delta<=1),'whole original chapter must fit without an inner scrollbar: '+state.overflow);
      await evaluate(`document.querySelectorAll('.epub-original-frame')[1].contentDocument.querySelector('.study-original-sentence[data-section="3"]').click()`);
      assert.equal(await evaluate('document.querySelector(".sent-span.highlight").dataset.section'),'3');
      assert.equal(await evaluate('document.getElementById("leftContent").hidden'),true);
      assert.equal(await evaluate('document.querySelector("#translationContent .translation-text.highlight").dataset.section'),'3');
      assert.equal(await evaluate('document.getElementById("readingModeToggle").hidden'),true);
      await evaluate('document.querySelector("#translationContent .translation-text[data-section=\\"3\\"]").click()');
      assert.equal(await evaluate('document.querySelectorAll(".epub-original-frame")[1].contentDocument.querySelector(".study-selected").dataset.section'),'3');
      assert.doesNotMatch(await evaluate('document.getElementById("readingModeStatus").textContent'),/正在/,'reusing an already loaded original view must clear the loading status');
      return {offline, ...state};
    }
    const online = await verifyView(false);
    await stop();
    const offlineStart = browser.requests.length;
    await browser.call('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
    await browser.navigate(pathToFileURL(savedPath).href);
    const offline = await verifyView(true);
    assert.deepEqual(browser.errors,[]);
    assert.equal(browser.requests.some(url=>url.includes('example.invalid')),false,'untrusted book resources must never make a request');
    assert.equal(browser.requests.slice(offlineStart).some(url=>/^https?:/.test(url)),false,'saved file must have zero HTTP requests');
    const screenshot = await browser.call('Page.captureScreenshot',{format:'png'});
    await fs.writeFile(savedPath.replace(/\.html$/,'-original-preview.png'),Buffer.from(screenshot.data,'base64'));
    console.log(JSON.stringify({status:'PASS',savedPath,serverStopped:!server.listening,online,offline,errors:browser.errors,checks:['two chapters','inline italics','book CSS and pictures','sentence/diagram link','selection preserved in both directions','script isolation','no external requests','offline original rendering']},null,2));
  } finally {await stop();await browser?.close();}
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
