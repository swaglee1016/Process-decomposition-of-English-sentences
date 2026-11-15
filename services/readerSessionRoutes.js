const express=require('express');
const fs=require('node:fs/promises');
const path=require('node:path');
const {parseDocument}=require('htmlparser2');
const {RESULT_NAME,requireId}=require('./readerSessionStore');

function sameOrigin(req){return (!req.get('origin')||req.get('origin')==='http://'+req.get('host'))&&req.get('sec-fetch-site')!=='cross-site';}
function sessionAccess(req,res,next){
 res.set('Cache-Control','no-store');
 if(!sameOrigin(req))return res.status(403).json({error:'请从本机阅读页面恢复阅读记录'});
 next();
}
async function loadSavedResult(outputDir,filename){
 requireId(filename,RESULT_NAME);
 const fullPath=path.join(outputDir,filename),stat=await fs.stat(fullPath);
 if(stat.size>96*1024*1024)throw Error('保存的阅读结果超过恢复容量，可直接打开 HTML 阅读');
 const html=await fs.readFile(fullPath,'utf8');
 const tree=parseDocument(html,{withStartIndices:true,withEndIndices:true});
 const scripts=new Map(),cards=[];const stack=[tree];
 while(stack.length){const node=stack.pop();if(node.name==='script'&&node.attribs?.id)scripts.set(node.attribs.id,(node.children||[]).map(n=>n.data||'').join(''));if(node.name==='article'&&/(?:^|\s)sent-card(?:\s|$)/.test(node.attribs?.class||''))cards.push(node);for(const child of [...node.children||[]].reverse())stack.push(child);}
 let data;
 if(scripts.has('readerResultData')){
  data=JSON.parse(scripts.get('readerResultData'));
  if(scripts.has('epubOriginalData'))data.original=JSON.parse(scripts.get('epubOriginalData')).original;
 }
 else{
  if(!scripts.has('epubOriginalData'))throw Error('这份历史文件没有可恢复的阅读数据，请直接打开已保存的 HTML');
  data=JSON.parse(scripts.get('epubOriginalData'));let index=0;
  for(const section of data.sections||[])for(const sentence of section.sentences||[]){const card=cards[index++];if(card){const start=html.indexOf('>',card.startIndex)+1,end=html.lastIndexOf('</article',card.endIndex);sentence.html=html.slice(start,end);}}
 }
 if(!Array.isArray(data.sections))throw Error('保存的阅读结果缺少正文数据');
 const vocabulary=scripts.has('vocabularyData')?JSON.parse(scripts.get('vocabularyData')):null;
 return {html,sections:data.sections,original:data.original||null,vocabulary,filename,outputUrl:'/outputs/'+encodeURIComponent(filename)};
}
function createReaderSessionRouter({store,outputDir,activeJobs,getVocabulary,baseUrl,runtime,cachedBookTitle}){
 const router=express.Router();
 router.use(['/workspace','/saved-result','/jobs','/recent-reading'],sessionAccess);
 function fail(res,error){res.status(error.status||(error.code==='ENOENT'?404:500)).json({error:error.status?error.message:error.code==='ENOENT'?'找不到已保存的阅读记录':'无法恢复阅读记录，原文件已保留',...(Number.isInteger(error.revision)?{revision:error.revision}:{})});}
 router.get('/workspace',async(req,res)=>{try{res.json(await store.readWorkspace());}catch(error){fail(res,error);}});
 router.put('/workspace',async(req,res)=>{
  if(runtime?.readerRestarting)return res.status(503).json({error:'阅读器正在更新，请等待页面重新连接'});
  if(runtime)runtime.analysisActive++;
  try{
   if(!req.is('application/json'))return res.status(415).json({error:'阅读状态必须使用 JSON 保存'});
   const saved=await store.saveWorkspace(req.body.state,req.body.revision);res.json({revision:saved.revision});
  }catch(error){fail(res,error);}finally{if(runtime)runtime.analysisActive--;}
 });
 router.get('/recent-reading',async(req,res)=>{
  try{res.json({items:await store.listRecentReading(cachedBookTitle)});}
  catch(error){fail(res,error);}
 });
 router.get('/recent-reading/:id',async(req,res)=>{
  try{res.json(await store.readRecentReading(req.params.id));}
  catch(error){fail(res,error);}
 });
 router.get('/saved-result/:filename',async(req,res)=>{try{const result=await loadSavedResult(outputDir,req.params.filename);result.vocabulary={...getVocabulary().snapshot(),token:getVocabulary().issueCapability(),baseUrl:baseUrl(req)};if(req.query.view==='reader'){const {html,...reader}=result;res.json(reader);}else res.json(result);}catch(error){fail(res,error);}});
 router.get('/jobs/:jobId',async(req,res)=>{try{const job=await store.readJob(req.params.jobId);res.json({...job,status:job.status==='complete'?'complete':activeJobs.has(job.jobId)?'running':'interrupted'});}catch(error){fail(res,error);}});
 return router;
}
module.exports={createReaderSessionRouter,loadSavedResult,sessionAccess,sameOrigin};
