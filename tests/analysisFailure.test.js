const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

function isolated(script) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    ['path','systemroot','windir','temp','tmp','home','userprofile'].includes(name.toLowerCase())));
  return JSON.parse(execFileSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'), env, encoding: 'utf8', windowsHide: true
  }));
}

test('missing API key fails before sending any model request', () => {
  const result = isolated(`
    let calls=0;
    global.fetch=async()=>{calls++;throw new Error('NETWORK_CALLED');};
    require('./services/deepseek').callDeepSeek('test','test',0,1000,0)
      .catch(e=>console.log(JSON.stringify({code:e.code,calls})));
  `);
  assert.equal(result.code, 'DEEPSEEK_API_KEY_MISSING');
  assert.equal(result.calls, 0);
});

test('authentication rejection has a safe actionable error without upstream response content', () => {
  const result = isolated(`
    process.env.DEEPSEEK_API_KEY='test-only-placeholder';
    global.fetch=async()=>new Response('upstream-private-canary',{status:401});
    require('./services/deepseek').callDeepSeek('test','test',0,1000,0)
      .catch(e=>console.log(JSON.stringify({code:e.code,message:e.message})));
  `);
  assert.equal(result.code, 'DEEPSEEK_AUTH_FAILED');
  assert.doesNotMatch(result.message, /upstream-private-canary|test-only-placeholder/);
});

test('shared configuration failure stops once and does not report a successfully completed article', async () => {
  const { createApp } = require('../server');
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sentence-auth-failure-'));
  let calls = 0;
  const server = createApp({ outputDir, delayMs: 0, analyzeSentence: async () => {
    calls++;
    throw Object.assign(new Error('未配置 DeepSeek API Key，请检查当前项目的 .env'), { code: 'DEEPSEEK_API_KEY_MISSING' });
  } }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const events = await new Promise((resolve, reject) => {
      const req = http.request({host:'127.0.0.1',port:server.address().port,path:'/api/process',method:'POST',headers:{'Content-Type':'application/json'}},res=>{
        let text='';res.setEncoding('utf8');res.on('data',part=>text+=part);res.on('end',()=>resolve(text));
      });req.on('error',reject);req.end(JSON.stringify({text:'One sentence. Another sentence.',reviewed:true}));
    });
    assert.match(events, /event: error/);
    assert.match(events, /DeepSeek API Key/);
    assert.doesNotMatch(events, /event: complete/);
    assert.equal(calls, 1);
    assert.deepEqual(await fs.readdir(outputDir), []);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
