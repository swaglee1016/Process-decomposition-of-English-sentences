// Manual offline acceptance: node tests/offlineViewerSmoke.js <saved-main.html> [screenshot.png]
// Uses installed Chrome with an isolated temporary profile; retains all artifacts.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');

async function until(action) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    try { const result = await action(); if (result) return result; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Browser acceptance condition timed out');
}

async function main() {
  assert.ok(process.argv[2], 'Provide the saved study HTML path');
  const filename = path.resolve(process.argv[2]);
  await fs.access(filename);
  const chrome = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'sentence-offline-chrome-'));
  const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--disable-background-networking',
    '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--window-size=1440,1000',
    '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, 'about:blank'],
  { windowsHide: true, stdio: 'ignore' });
  let startupError;
  child.on('error', error => { startupError = error; });
  let socket;
  let send;
  try {
    const portInfo = await until(async () => {
      if (startupError) throw startupError;
      return (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/);
    });
    socket = new WebSocket(`ws://127.0.0.1:${portInfo[0]}${portInfo[1]}`);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    const pending = new Map();
    const networkUrls = [];
    let nextId = 0;
    socket.onmessage = event => {
      const data = JSON.parse(event.data);
      if (data.method === 'Network.requestWillBeSent') networkUrls.push(data.params.request.url);
      const entry = pending.get(data.id);
      if (entry) { pending.delete(data.id); clearTimeout(entry.timer); data.error ? entry.reject(new Error(data.error.message)) : entry.resolve(data.result); }
    };
    send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
    async function attach(targetId) {
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      await send('Page.enable', {}, sessionId);
      await send('Network.enable', {}, sessionId);
      await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 }, sessionId);
      return sessionId;
    }
    async function evaluate(sessionId, expression) {
      const value = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (value.exceptionDetails) throw new Error(value.exceptionDetails.text);
      return value.result.value;
    }
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const mainSession = await attach(targetId);
    await send('Page.navigate', { url: pathToFileURL(filename).href }, mainSession);
    const study = await until(() => evaluate(mainSession, `(() => {
      const images=[...document.images], links=[...document.querySelectorAll('a.diagram-open')];
      return images.length && images.every(i=>i.complete && i.naturalWidth>0) && links.length && {
        images:images.length, links:links.length, firstLink:links[0].href,
        source:document.querySelector('.para-text')?.textContent
      };
    })()`));
    assert.ok(study.source?.length);
    assert.ok(study.firstLink.startsWith('file:///'));
    await send('Page.bringToFront', {}, mainSession);
    const linkPoint = await evaluate(mainSession, `(() => {
      const link=document.querySelector('a.diagram-open');
      link.scrollIntoView({block:'center',inline:'center'});
      const rect=link.getBoundingClientRect();
      return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};
    })()`);
    // Trusted browser input exercises the link exactly as a user click does.
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...linkPoint, button: 'left', clickCount: 1 }, mainSession);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...linkPoint, button: 'left', clickCount: 1 }, mainSession);
    const viewerTarget = await until(async () => (await send('Target.getTargets')).targetInfos.find(t => t.type === 'page' && t.url === study.firstLink));
    const viewerSession = await attach(viewerTarget.targetId);
    await send('Page.bringToFront', {}, viewerSession);
    await until(() => evaluate(viewerSession, `document.getElementById('diagramImage')?.naturalWidth > 0`));
    const initial = await evaluate(viewerSession, `document.getElementById('zoomLabel').textContent`);
    const zoomed = await evaluate(viewerSession, `(() => {
      document.getElementById('zoomActual').click();
      for(let n=0;n<5;n++) document.getElementById('zoomIn').click();
      return document.getElementById('zoomLabel').textContent;
    })()`);
    assert.ok(parseInt(zoomed) > 100);
    const viewport = await evaluate(viewerSession, `(() => {
      const v=document.getElementById('diagramViewport'), r=v.getBoundingClientRect();
      v.scrollLeft=100; v.scrollTop=0;
      return {x:r.x+300,y:r.y+200,left:v.scrollLeft};
    })()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: viewport.x, y: viewport.y, button: 'left', clickCount: 1 }, viewerSession);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: viewport.x - 100, y: viewport.y, button: 'left', buttons: 1 }, viewerSession);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: viewport.x - 100, y: viewport.y, button: 'left', clickCount: 1 }, viewerSession);
    const dragged = await evaluate(viewerSession, `document.getElementById('diagramViewport').scrollLeft`);
    assert.ok(dragged > viewport.left, 'Pointer dragging must move the image viewport');
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: viewport.x, y: viewport.y, deltaX: 0, deltaY: -100 }, viewerSession);
    const wheeled = await until(async () => {
      const label=await evaluate(viewerSession, `document.getElementById('zoomLabel').textContent`);
      return parseInt(label)>parseInt(zoomed) && label;
    });
    await evaluate(viewerSession, `document.getElementById('zoomFit').click()`);
    if (process.argv[3]) {
      const screenshot = await send('Page.captureScreenshot', { format: 'png' }, viewerSession);
      await fs.writeFile(path.resolve(process.argv[3]), Buffer.from(screenshot.data, 'base64'));
    }
    assert.equal(networkUrls.filter(url => /^https?:/i.test(url)).length, 0, 'Saved files must not request network assets');
    console.log(JSON.stringify({ status: 'PASS', filename, study, initial, zoomed, dragged, wheeled,
      networkRequests: 0, profile, checks: ['offline main images', 'relative link opens new page', 'zoom buttons', 'pointer drag', 'wheel zoom', 'fit window'] }, null, 2));
  } finally {
    if (send) { try { await send('Browser.close'); } catch {} }
    if (socket) socket.close();
    if (child.exitCode === null) child.kill();
  }
}

main().catch(error => { console.error(error.stack); process.exitCode = 1; });
