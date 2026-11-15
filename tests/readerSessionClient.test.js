const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');

test('switching a recent item saves the outgoing state before reloading the incoming state',async()=>{
 const outgoing={schema:1,input:{text:'Draft',paragraphMode:'preserve'}};
 const incoming={schema:1,bookId:'a'.repeat(64)};
 const requests=[];let reloads=0,revision=0;
 const root={crypto:{randomUUID:()=> 'test-reader-client'},addEventListener(){},setInterval:()=>1,clearInterval(){},setTimeout,location:{reload(){reloads++;}}};
 const context=vm.createContext({window:root,AbortController,fetch:async(url,options={})=>{
  if(url.startsWith('/api/reader/connection'))return {ok:true,body:{getReader:()=>({read:()=>new Promise(()=>{}),releaseLock(){}})}};
  if(url==='/api/workspace'&&options.method==='PUT'){
   requests.push(JSON.parse(options.body));return {ok:true,json:async()=>({revision:++revision})};
  }
  if(url==='/api/workspace')return {ok:true,json:async()=>({state:null,revision})};
  return {ok:true,json:async()=>({instanceId:'one'})};
 }});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/readerSession.js'),'utf8'),context);
 const session=root.ReaderSession.mount({capture:()=>outgoing,restore:async()=>{},status:{}});
 await session.initialized;
 let loaded=false;
 await session.activate(async()=>{
  assert.deepEqual(requests,[{state:outgoing,revision:0}]);
  loaded=true;return incoming;
 });
 await session.flush();
 assert.deepEqual(requests,[{state:outgoing,revision:0},{state:incoming,revision:1}]);
 assert.equal(loaded,true);assert.equal(reloads,1);session.destroy();
});

test('a restored pre-library book is saved with its resolved chapter label',async()=>{
 const legacy={schema:1,bookId:'a'.repeat(64),selection:{activeId:'3'}};
 let current,submitted;
 const root={crypto:{randomUUID:()=> 'test-reader-client'},addEventListener(){},setInterval:()=>1,clearInterval(){},setTimeout,location:{reload(){}}};
 const context=vm.createContext({window:root,AbortController,fetch:async(url,options={})=>{
  if(url.startsWith('/api/reader/connection'))return {ok:true,body:{getReader:()=>({read:()=>new Promise(()=>{}),releaseLock(){}})}};
  if(url==='/api/workspace'&&options.method==='PUT'){
   submitted=JSON.parse(options.body).state;return {ok:true,json:async()=>({revision:2})};
  }
  if(url==='/api/workspace')return {ok:true,json:async()=>({state:legacy,revision:1})};
  return {ok:true,json:async()=>({instanceId:'one'})};
 }});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/readerSession.js'),'utf8'),context);
 const session=root.ReaderSession.mount({capture:()=>current,
  restore:async state=>{current={...state,readingLabel:{title:'A book',chapter:'Chapter Four'}};},status:{}});
 await session.initialized;await session.flush();
 assert.deepEqual(submitted?.readingLabel,{title:'A book',chapter:'Chapter Four'});
 session.destroy();
});

test('a page opened during backend restart retries restoration before saving defaults',async()=>{
 let tick,first=true,state={schema:1,input:{text:'',paragraphMode:'preserve'}},restored=0,writes=0;
 const root={crypto:{randomUUID:()=> 'test-reader-client'},addEventListener(){},setInterval:fn=>{tick=fn;return 1;},
   clearInterval(){},setTimeout,location:{reload(){}}};
 const context=vm.createContext({window:root,AbortController,fetch:async(url,options={})=>{
   if(url.startsWith('/api/reader/connection'))return {ok:true,body:{getReader:()=>({read:()=>new Promise(()=>{}),releaseLock(){}})}};
   if(url==='/api/workspace'&&options.method!=='PUT'){
    if(first){first=false;throw Error('Restart window');}
    return {ok:true,json:async()=>({revision:4,state:{schema:1,input:{text:'Saved draft',paragraphMode:'preserve'}}})};
   }
   if(url==='/api/workspace'){writes++;return {ok:true,json:async()=>({revision:5})};}
   return {ok:true,json:async()=>({instanceId:'one'})};
 }});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/readerSession.js'),'utf8'),context);
 const session=root.ReaderSession.mount({capture:()=>state,restore:async value=>{state=value;restored++;},status:{}});
 await session.initialized;await session.flush();assert.equal(writes,0);
 tick();await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(restored,1);assert.equal(state.input.text,'Saved draft');
 state={...state,input:{...state.input,text:'Next edit'}};await session.flush();assert.equal(writes,1);
 session.destroy();
});

test('coalesced saves wait for the latest edit and reconcile an already saved response after reconnect',async()=>{
 let state={schema:1,input:{text:'First edit',paragraphMode:'preserve'}},revision=0,saved=null,release,entered;
 const blocked=new Promise(resolve=>entered=resolve);let writes=0,loseResponse=true;
 const root={crypto:{randomUUID:()=> 'test-reader-client'},addEventListener(){},setInterval:()=>1,clearInterval(){},setTimeout,location:{reload(){}}};
 const context=vm.createContext({window:root,AbortController,fetch:async(url,options={})=>{
  if(url.startsWith('/api/reader/connection'))return {ok:true,body:{getReader:()=>({read:()=>new Promise(()=>{}),releaseLock(){}})}};
  if(url==='/api/workspace'){
   if(options.method!=='PUT')return {ok:true,json:async()=>({state:saved,revision})};
   const body=JSON.parse(options.body);writes++;
   if(writes===1){entered();await new Promise(resolve=>release=resolve);}
   if(body.revision!==revision)return {ok:false,status:409,json:async()=>({error:'Conflict'})};
   saved=body.state;revision++;
   if(loseResponse){loseResponse=false;throw Error('Disconnected after save');}
   return {ok:true,json:async()=>({revision})};
  }
  return {ok:true,json:async()=>({instanceId:'one'})};
 }});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/readerSession.js'),'utf8'),context);
 const session=root.ReaderSession.mount({capture:()=>state,restore:async()=>{},status:{}});
 await session.initialized;
 const first=session.flush();await blocked;release();await first;
 await session.flush();assert.equal(saved.input.text,'First edit');
 state={...state,input:{...state.input,text:'Second edit'}};
 const pending=session.flush();state={...state,input:{...state.input,text:'Third edit'}};
 await session.flush();await pending;
 assert.equal(saved.input.text,'Third edit');
 session.destroy();
});
