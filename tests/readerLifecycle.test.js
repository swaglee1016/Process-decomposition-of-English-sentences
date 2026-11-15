const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const {createReaderLifecycle} = require('../services/readerLifecycle');

test('reader presence suppresses duplicate opens and a busy reader rejects restart',async()=>{
  const app=express();app.use(express.json());
  app.use('/api/reader',createReaderLifecycle(app));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port+'/api/reader';
  const headers={'Content-Type':'application/json','X-Reader-Client':'workspace'};
  const send=(path,body)=>fetch(base+path,{method:'POST',headers,body:JSON.stringify(body)});
  try{
    assert.equal((await (await send('/open',{})).json()).open,true);
    assert.equal((await (await send('/open',{})).json()).open,false);
    await send('/presence',{clientId:'one-reader-tab'});
    const state=await (await fetch(base+'/status',{headers})).json();
    assert.equal(state.clients,1);assert.ok(state.buildId);assert.ok(state.instanceId);
    app.locals.analysisActive=1;
    assert.equal((await send('/restart',{})).status,409);
    assert.equal((await fetch(base+'/presence',{method:'POST',headers:{...headers,Origin:'http://foreign.invalid'},body:'{}'})).status,403);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
