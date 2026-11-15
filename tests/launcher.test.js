const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => body += chunk);
      response.on('end', () => resolve(body));
    }).on('error', reject);
  });
}
async function close(server) {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
function launcher() {
  const filename = path.join(__dirname, '..', 'launcher.js');
  assert.ok(fs.existsSync(filename), 'A ready-aware application launcher is required');
  return require(filename).startApplication;
}

test('double-click entry delegates browser opening to the ready-aware launcher', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'start.bat'), 'utf8');
  assert.match(source, /node\s+launcher\.js/i);
  assert.doesNotMatch(source, /start\s+https?:/i, 'Must not open an old server before the new one listens');
});

test('an unrelated program occupying the fixed address is reported without opening another address', async () => {
  const startApplication = launcher();
  const oldServer = http.createServer((req, res) => res.end('OLD APP')).listen(0);
  await new Promise(resolve => oldServer.once('listening', resolve));
  let launched;
  const opened = [];
  try {
    await assert.rejects(startApplication({port:oldServer.address().port,log:()=>{},openBrowser:async url=>opened.push(url)}),/占用/);
    assert.equal(opened.length, 0);
    assert.equal(await get(`http://127.0.0.1:${oldServer.address().port}/`), 'OLD APP');
  } finally {
    if (launched) await close(launched.server);
    await close(oldServer);
  }
});

test('repeated launch reuses this project server and only opens one browser page',async()=>{
  const startApplication=launcher(),opened=[];
  let first;
  try{
    first=await startApplication({port:0,presenceGraceMs:0,log:()=>{},openBrowser:async url=>opened.push(url)});
    const second=await startApplication({port:first.server.address().port,presenceGraceMs:0,log:()=>{},openBrowser:async url=>opened.push(url),focusBrowser:async()=>true});
    assert.equal(second.url,first.url);assert.equal(second.reused,true);
    assert.equal(opened.length,1);
  }finally{if(first)await close(first.server);}
});

test('updating with a background reader tab waits for that tab instead of opening another',async()=>{
  const {projectId}=require('../services/readerLifecycle');let opened=0,launched;
  const oldServer=http.createServer((req,res)=>{
    res.setHeader('Content-Type','application/json');
    if(req.url==='/api/reader/restart'){
      res.end('{"restarting":true}');
      setTimeout(()=>{oldServer.closeAllConnections();oldServer.close();},20);
    }else res.end(JSON.stringify({app:'sentence-process',projectId,buildId:'old-build',instanceId:'old-instance',clients:1}));
  }).listen(0,'127.0.0.1');
  await new Promise(resolve=>oldServer.once('listening',resolve));
  const port=oldServer.address().port;
  try{
    launched=await launcher()({port,presenceGraceMs:0,log:()=>{},openBrowser:async()=>opened++,focusBrowser:async()=>true});
    assert.equal(launched.server.address().port,port);assert.equal(opened,0);
  }finally{
    if(launched)await close(launched.server);
    if(oldServer.listening)await close(oldServer);
  }
});

test('invalid startup port never opens a browser', async () => {
  const startApplication = launcher();
  let opened = false;
  await assert.rejects(startApplication({port: -1, openBrowser: () => { opened = true; }, log: () => {}}), /port/i);
  assert.equal(opened, false);
});

test('launching with an existing reader brings its tab forward without opening a duplicate', async () => {
  let first;const focused=[],opened=[];
  try {
    first=await launcher()({port:0,presenceGraceMs:0,log:()=>{},openBrowser:async()=>{}});
    await fetch(first.url+'api/reader/presence',{method:'POST',headers:{'Content-Type':'application/json','X-Reader-Client':'workspace'},body:JSON.stringify({clientId:'existing-reader-tab'})});
    const second=await launcher()({port:first.server.address().port,presenceGraceMs:0,log:()=>{},
      openBrowser:async url=>opened.push(url),focusBrowser:async url=>{focused.push(url);return true;}});
    assert.deepEqual(focused,[first.url]);
    assert.deepEqual(opened,[]);
    assert.equal(second.browserFocused,true);
    assert.equal(second.reused,true);
  } finally {if(first)await close(first.server);}
});

test('a failed foreground activation gives the user a visible explanation instead of silently exiting',async()=>{
  let first;const messages=[];
  try {
    first=await launcher()({port:0,presenceGraceMs:0,log:()=>{},openBrowser:async()=>{}});
    const second=await launcher()({port:first.server.address().port,presenceGraceMs:0,log:()=>{},
      openBrowser:async()=>assert.fail('Must not create another tab during reuse'),focusBrowser:async()=>false,
      notify:async message=>messages.push(message)});
    assert.equal(second.browserFocused,false);
    assert.equal(messages.length,1);
    assert.match(messages[0],/127\.0\.0\.1/);
    assert.match(messages[0],/已.*运行/);
  } finally {if(first)await close(first.server);}
});
