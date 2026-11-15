// Browser acceptance: node tests/navigationBrowserSmoke.js [--online]
// Uses synthetic text and SVGs only. Retains temporary HTML and Chrome profile.
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const { buildCompleteStudyHtml, buildSentenceHtml } = require('../services/htmlBuilder');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(action, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await action();
    if (value) return value;
    await wait(100);
  }
  throw new Error('Timed out waiting for Chrome');
}

async function main() {
  const count = 90;
  const sentences = Array.from({ length: count }, (_, index) => {
    const text = index === 0 ? 'We waited.' : index === 1 ? 'Rain fell.' : `Synthetic sentence number ${index + 1}.`;
    const height = index % 2 ? 1400 : 500;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${height}"><rect width="1200" height="${height}" fill="white"/><text x="24" y="72" font-size="42">Diagram ${index + 1}</text></svg>`;
    const base64 = Buffer.from(svg).toString('base64');
    return { text, translation:`这是第 ${index + 1} 句的中文参考译文。`, html: buildSentenceHtml(text, base64, 'image/svg+xml') };
  });
  const sections = Array.from({length:count/3},(_,index)=>{
    const group=sentences.slice(index*3,index*3+3);
    return {paragraph:group.map(sentence=>sentence.text).join(' '),sentences:group};
  });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sentence-navigation-smoke-'));
  const filename = path.join(directory, 'synthetic-navigation.html');
  await fs.writeFile(filename, buildCompleteStudyHtml(sections), 'utf8');
  let appServer;
  if (process.argv.includes('--online')) {
    appServer = require('../server').createApp({outputDir:directory}).listen(0,'127.0.0.1');
    await new Promise(resolve=>appServer.once('listening',resolve));
  }
  const profile = path.join(directory, 'chrome-profile');
  const chrome = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe');
  const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--disable-background-networking', '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--window-size=1440,1000', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let socket, send, startupError;
  child.on('error', error => { startupError = error; });
  try {
    const port = await until(async () => {
      if (startupError) throw startupError;
      try { return (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/); }
      catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    });
    socket = new WebSocket(`ws://127.0.0.1:${port[0]}${port[1]}`);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    const pending = new Map();
    let id = 0;
    socket.onmessage = event => {
      const data = JSON.parse(event.data);
      const item = pending.get(data.id);
      if (!item) return;
      pending.delete(data.id);
      clearTimeout(item.timer);
      data.error ? item.reject(new Error(data.error.message)) : item.resolve(data.result);
    };
    send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const current = ++id;
      const timer = setTimeout(() => { pending.delete(current); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
      pending.set(current, { resolve, reject, timer });
      socket.send(JSON.stringify({ id: current, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Page.enable', {}, sessionId);
    await send('Runtime.enable', {}, sessionId);
    await send('Page.navigate', { url: appServer ? `http://127.0.0.1:${appServer.address().port}` : pathToFileURL(filename).href }, sessionId);
    async function evaluate(expression) {
      const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
      return response.result.value;
    }
    if (appServer) {
      await until(()=>evaluate(`typeof renderSections === 'function'`));
      await evaluate(`sectionsData=${JSON.stringify(sections)};renderSections();`);
    }
    await until(() => evaluate(`document.querySelectorAll('.sent-card').length === ${count}`));
    const target = 75;
    const measure = `(() => {
      const panel = document.getElementById('panelRight');
      const card = document.querySelector('.sent-card[data-section="${target}"]');
      const header = panel.querySelector('.panel-header');
      const image = card.querySelector('img');
      return { panelScroll: panel.scrollTop, targetTop: Math.round(card.getBoundingClientRect().top - panel.getBoundingClientRect().top), expectedTop: header.offsetHeight + 14, targetHeight: Math.round(card.getBoundingClientRect().height), loadedBefore: [...document.querySelectorAll('.sent-card img')].slice(0, ${target}).filter(img => img.complete && img.naturalWidth).length, targetLoaded: !!image.naturalWidth };
    })()`;
    const before = await evaluate(measure);
    await evaluate(`document.querySelector('.sent-span[data-section="${target}"]').click()`);
    const samples = [];
    for (const delay of [0, 250, 700, 1500, 3000]) {
      if (delay) await wait(delay - (samples.length ? [0, 250, 700, 1500][samples.length - 1] : 0));
      samples.push({ milliseconds: delay, ...await evaluate(measure) });
    }
    console.log(JSON.stringify({ filename, target, before, samples }, null, 2));
    const final = samples.at(-1);
    assert.ok(Math.abs(final.targetTop - final.expectedTop) <= 6,
      `One click should place target near the right panel header; drift=${final.targetTop - final.expectedTop}px`);
    const layout = await evaluate(`(() => {
      const en=document.querySelector('.para-text'),zh=document.querySelector('.translation-paragraph');
      const a=en.getBoundingClientRect(),b=zh.getBoundingClientRect();
      const spans=[...en.querySelectorAll('.sent-span')];
      return {topDelta:Math.abs(a.top-b.top),widthRatio:a.width/b.width,rightRatio:document.getElementById('panelRight').clientWidth/document.querySelector('.dual-panel').clientWidth,translation:zh.querySelector('.translation-text').textContent,english:en.textContent,paragraphs:document.querySelectorAll('.para-text').length,display:getComputedStyle(spans[0]).display,sameLine:Math.abs(spans[0].getClientRects()[0].top-spans[1].getClientRects()[0].top)<1,lineHeightEnglish:getComputedStyle(en).lineHeight,lineHeightChinese:getComputedStyle(zh).lineHeight};
    })()`);
    assert.equal(layout.display,'inline');assert.equal(layout.sameLine,true,'Consecutive short English sentences must flow on the same line');
    assert.equal(layout.paragraphs,30);assert.equal(layout.english,sections[0].paragraph);
    assert.equal(layout.lineHeightEnglish,layout.lineHeightChinese);
    assert.ok(layout.topDelta<1);assert.ok(Math.abs(layout.widthRatio-3)<.1);assert.ok(Math.abs(layout.rightRatio-.6)<.02);
    assert.equal(layout.translation,'这是第 1 句的中文参考译文。');
    await evaluate(`for(const id of [69,9,79])document.querySelector('.sent-span[data-section="'+id+'"]').click();`);
    await wait(200);
    const latest = await evaluate(`(() => { const panel=document.getElementById('panelRight'),card=document.querySelector('.sent-card[data-section="79"]');return {top:card.getBoundingClientRect().top-panel.getBoundingClientRect().top,expected:panel.querySelector('.panel-header').offsetHeight+12,highlight:[...document.querySelectorAll('.sent-span.highlight,.translation-text.highlight')].map(el=>el.dataset.section)}; })()`);
    assert.ok(Math.abs(latest.top-latest.expected)<2);assert.deepEqual(latest.highlight,['79','79']);
    await evaluate(`document.querySelector('.translation-text[data-section="40"]').click()`);
    await wait(100);
    const translated = await evaluate(`document.querySelector('.sent-span.highlight')?.dataset.section`);
    assert.equal(translated,'40');
    const position = await evaluate(`(() => {const p=document.getElementById('panelRight'),r=p.getBoundingClientRect();return {x:r.left+80,y:r.top+150,before:p.scrollTop};})()`);
    await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:position.x,y:position.y,deltaX:0,deltaY:180},sessionId);
    await until(async()=>await evaluate(`document.getElementById('panelRight').scrollTop`)>position.before+50);
    await evaluate(`window.dispatchEvent(new Event('resize'))`);await wait(200);
    assert.ok(await evaluate(`document.getElementById('panelRight').scrollTop`)>position.before+50,'Manual scrolling must release the selected anchor');
    await evaluate(`document.querySelector('.sent-span[data-section="0"]').click();document.querySelector('.panel-left').scrollTop=0`);
    const screenshot = await send('Page.captureScreenshot',{format:'png'},sessionId);
    const screenshotPath=path.join(directory,appServer?'online-bilingual.png':'offline-bilingual.png');
    await fs.writeFile(screenshotPath,Buffer.from(screenshot.data,'base64'));
    await send('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:false},sessionId);
    await wait(150);
    assert.ok(await evaluate(`document.documentElement.scrollWidth <= innerWidth+1`),'Narrow layout must not overflow horizontally');
    console.log(JSON.stringify({status:'PASS',mode:appServer?'online':'offline',layout,rapidTarget:latest,translationClick:translated,screenshotPath,checks:['single click','rapid switch','translation alignment','right width','manual scroll release','375px layout']}));
  } finally {
    if (send) { try { await send('Browser.close'); } catch {} }
    if (socket) socket.close();
    if (child.exitCode === null) child.kill();
    if(appServer){appServer.closeAllConnections();await new Promise(resolve=>appServer.close(resolve));}
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
