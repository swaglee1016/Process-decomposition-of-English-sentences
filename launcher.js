const { execFile } = require('node:child_process');
const net = require('node:net');
const { createApp } = require('./server');
const {currentBuild,projectId} = require('./services/readerLifecycle');
const {activateReaderWindow,showLaunchMessage}=require('./services/readerWindow');

function openDefaultBrowser(url) {
  return new Promise((resolve, reject) => {
    execFile('rundll32.exe', ['url.dll,FileProtocolHandler', url], {
      windowsHide: true, shell: false, timeout: 10000
    }, error => error ? reject(error) : resolve());
  });
}

async function startApplication({ port = 3456, openBrowser = openDefaultBrowser, focusBrowser = activateReaderWindow,
  log = console.log, notify = log, presenceGraceMs = 1500 } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError('Invalid application port');
  const headers={'X-Reader-Client':'workspace','Content-Type':'application/json'};
  async function request(url,method='GET',body) {
    const response=await fetch(url,{method,headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(2500)});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||'阅读器连接失败');
    return data;
  }
  const preferred='http://127.0.0.1:'+port;
  let status,waitForExistingTab=false;
  if(port){
    try{status=await request(preferred+'/api/reader/status');}
    catch{
      const occupied=await new Promise(resolve=>{
        const socket=net.createConnection({host:'127.0.0.1',port});
        const finish=inUse=>{socket.destroy();resolve(inUse);};
        socket.once('connect',()=>finish(true));socket.once('error',error=>finish(error.code!=='ECONNREFUSED'));socket.setTimeout(1000,()=>finish(true));
      });
      if(occupied)throw new Error('固定地址已被其他程序或旧版阅读器占用，请先完成旧版的一次性更新');
    }
    if(status&&status.projectId!==projectId)throw new Error('固定地址已被另一个项目占用');
    waitForExistingTab=!!status?.clients;
    if(status&&status.buildId!==currentBuild()){
      await request(preferred+'/api/reader/restart','POST',{});
      for(let attempt=0;attempt<40;attempt++){
        await new Promise(resolve=>setTimeout(resolve,100));
        try{const latest=await request(preferred+'/api/reader/status');if(latest.instanceId===status.instanceId)continue;status=latest;break;}
        catch{status=null;break;}
      }
      if(status?.buildId!==currentBuild()&&status)throw new Error('后台尚未完成更新，请稍后再次启动');
    }
  }
  let app,server;
  function listen() {
    return new Promise((resolve, reject) => {
      const candidate = app.listen(port, '127.0.0.1');
      candidate.once('error', reject);
      candidate.once('listening', () => {
        candidate.removeListener('error', reject);
        resolve(candidate);
      });
    });
  }
  if(!status){
    app=createApp();
    try{server=await listen();}
    catch(error){
      if(error.code!=='EADDRINUSE'||!port)throw error;
      status=await request(preferred+'/api/reader/status');
      if(status.projectId!==projectId)throw new Error('固定地址已被其他程序占用');
    }
    if(server)app.locals.restartReader=()=>{
      server.closeAllConnections();
      server.close(()=>app.locals.closeVocabulary());
    };
  }
  const url = `http://127.0.0.1:${server?server.address().port:port}/`;
  log(`Project: ${__dirname}`);
  log(`Local SVG edition ready: ${url}`);
  log(server?'Reader started. Keep this background process running.':'Existing reader reused.');
  let browserOpened = false,browserFocused = false;
  try {
    if(presenceGraceMs)await new Promise(resolve=>setTimeout(resolve,presenceGraceMs));
    if(!waitForExistingTab){
      const claim=await request(url+'api/reader/open','POST',{});
      if(claim.open){await openBrowser(url);browserOpened=true;}
    }
    if(!browserOpened){
      browserFocused=await focusBrowser(url);
      if(!browserFocused)await notify(`阅读器已在后台运行。请切回浏览器中的阅读页面；也可以在地址栏输入 ${url} 继续阅读。`);
    }
  } catch(error) {
    log(`Could not open the browser automatically. Open ${url} manually.`);
    await notify(`阅读器已启动，但未能显示阅读页面。请在浏览器打开 ${url}。`);
  }
  return { server, url, browserOpened, browserFocused, reused:!server };
}

if (require.main === module) {
  startApplication({notify:showLaunchMessage}).catch(async error => {
    console.error(`Application could not start: ${error.message}`);
    try {await showLaunchMessage(`阅读器未能启动：${error.message}`);}catch{}
    process.exitCode = 1;
  });
}

module.exports = { startApplication };
