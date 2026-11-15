const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');

async function until(action, timeout = 12000) {
  const deadline = Date.now()+timeout;
  while (Date.now()<deadline) {
    const result = await action();
    if (result) return result;
    await new Promise(resolve=>setTimeout(resolve,80));
  }
  throw new Error('Browser acceptance condition timed out');
}
async function openBrowser() {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(),'sentence-original-chrome-'));
  const chrome = path.join(process.env.ProgramFiles || 'C:\\Program Files','Google/Chrome/Application/chrome.exe');
  const child = spawn(chrome,['--headless=new','--disable-gpu','--disable-background-networking','--disable-extensions',
    '--no-first-run','--no-default-browser-check','--window-size=1440,1000','--remote-debugging-port=0',
    '--remote-debugging-address=127.0.0.1',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
  let startupError,socket;
  child.on('error',error=>{startupError=error;});
  try {
    const port = await until(async()=>{
      if (startupError) throw startupError;
      try {return (await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).trim().split(/\r?\n/);}
      catch(error){if(['ENOENT','EBUSY'].includes(error.code))return false;throw error;}
    });
    socket = new WebSocket(`ws://127.0.0.1:${port[0]}${port[1]}`);
    await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
    const pending = new Map(),requests = [],errors = [];
    let id = 0;
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.method==='Network.requestWillBeSent') requests.push(message.params.request.url);
      if (message.method==='Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
      const item = pending.get(message.id);
      if (item) {pending.delete(message.id);clearTimeout(item.timer);message.error?item.reject(new Error(message.error.message)):item.resolve(message.result);}
    };
    const send = (method,params={},sessionId) => new Promise((resolve,reject)=>{
      const current = ++id;
      const timer = setTimeout(()=>{pending.delete(current);reject(new Error('CDP timeout: '+method));},20000);
      pending.set(current,{resolve,reject,timer});socket.send(JSON.stringify({id:current,method,params,...(sessionId?{sessionId}:{})}));
    });
    const {targetId} = await send('Target.createTarget',{url:'about:blank'});
    const {sessionId} = await send('Target.attachToTarget',{targetId,flatten:true});
    const call = (method,params={}) => send(method,params,sessionId);
    for (const name of ['Page.enable','Runtime.enable','Network.enable']) await call(name);
    async function evaluate(expression) {
      const result = await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
      if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    }
    return {call,evaluate,requests,errors,profile,until,
      async attachToPage(pageId){const {sessionId:pageSession}=await send('Target.attachToTarget',{targetId:pageId,flatten:true});return (method,params={})=>send(method,params,pageSession);},
      navigate:url=>call('Page.navigate',{url}),
      async close(){try{await send('Browser.close');}catch{}socket.close();if(child.exitCode===null)child.kill();}};
  } catch(error) {socket?.close();if(child.exitCode===null)child.kill();throw error;}
}
module.exports = {openBrowser,until};
