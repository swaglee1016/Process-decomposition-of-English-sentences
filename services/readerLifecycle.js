const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');

const root = path.resolve(__dirname,'..');
const projectId = crypto.createHash('sha256').update(root.toLowerCase()).digest('hex');
function currentBuild() {
  const hash=crypto.createHash('sha256');
  const files=['server.js','launcher.js','package.json'];
  for(const directory of ['public','services']){
    for(const name of fs.readdirSync(path.join(root,directory)).sort()){
      if(/\.(js|css|html)$/.test(name))files.push(directory+'/'+name);
    }
  }
  for(const file of files)hash.update(file).update(fs.readFileSync(path.join(root,file)));
  return hash.digest('hex');
}
function createReaderLifecycle(app) {
  const router=express.Router();
  const buildId=currentBuild(),instanceId=crypto.randomUUID(),clients=new Map(),connections=new Map();
  let openedAt=0;
  const prune=()=>{for(const [id,time] of clients)if(Date.now()-time>6500)clients.delete(id);};
  const clientCount=()=>new Set([...clients.keys(),...connections.keys()]).size;
  router.use((req,res,next)=>{
    res.set('Cache-Control','no-store');
    const origin=req.get('origin');
    if(req.get('x-reader-client')!=='workspace'||req.get('sec-fetch-site')==='cross-site'||
      (origin&&origin!=='http://'+req.get('host')))return res.status(403).json({error:'请从本机阅读器连接'});
    prune();next();
  });
  router.get('/status',(req,res)=>res.json({app:'sentence-process',projectId,buildId,instanceId,
    clients:clientCount(),activeJobs:app.locals.analysisActive||0}));
  router.get('/connection',(req,res)=>{
    const id=String(req.query.clientId||'');
    if(!/^[\w-]{8,80}$/.test(id))return res.status(400).json({error:'阅读页面标识无效'});
    if(connections.size>=64)return res.status(429).end();
    res.set({'Content-Type':'text/event-stream','Connection':'keep-alive'});
    res.flushHeaders();connections.set(id,res);
    res.write('data: connected\n\n');
    const keepalive=setInterval(()=>{if(!res.destroyed)res.write(': connected\n\n');},15000);keepalive.unref();
    res.on('close',()=>{
      clearInterval(keepalive);
      if(connections.get(id)===res){connections.delete(id);clients.delete(id);}
    });
  });
  router.post('/presence',(req,res)=>{
    const id=req.body?.clientId;
    if(typeof id!=='string'||!/^[\w-]{8,80}$/.test(id))return res.status(400).json({error:'阅读页面标识无效'});
    if(!clients.has(id)&&clients.size>=64)return res.status(429).json({error:'打开的阅读页面过多'});
    clients.set(id,Date.now());res.json({instanceId});
  });
  router.post('/open',(req,res)=>{
    const open=!clientCount()&&Date.now()-openedAt>10000;
    if(open)openedAt=Date.now();
    res.json({open});
  });
  router.post('/restart',(req,res)=>{
    if(app.locals.analysisActive)return res.status(409).json({error:'正在分析，请完成或暂停后再更新'});
    if(!app.locals.restartReader)return res.status(409).json({error:'请使用启动器更新阅读程序'});
    app.locals.readerRestarting=true;
    res.json({restarting:true});
    setTimeout(()=>app.locals.restartReader(),80);
  });
  return router;
}
module.exports={createReaderLifecycle,currentBuild,projectId};
