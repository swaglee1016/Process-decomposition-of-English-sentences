const express=require('express');
const {normalizeWord}=require('../public/vocabularyShared');
const {validateContext}=require('./contextDictionary');
function localRequest(req){
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))return false;
  try{const host=new URL('http://'+req.get('host'));return ['127.0.0.1','localhost','[::1]'].includes(host.hostname)&&Number(host.port||80)===req.socket.localPort;}catch{return false;}
}
function allowedOrigin(req){const origin=req.get('origin');return !origin||origin==='null'||origin==='http://'+req.get('host');}
function createVocabularyRouter({getStore,lookup,contextLookup,eudicShortcut}){
  let shortcutBusy=false;
  const router=express.Router(),pending=new Map(),explanations=new Map(),contextPending=new Map(),contexts=new Map();
  function withNotes(word,result){if(!result.dictionary)return result;const stored=getStore().detail(word,true)?.dictionary?.contextNotes||[];const notes=new Map(stored.map(note=>[note.context,note]));for(const note of contexts.values())if(note.word===word)notes.set(note.context,note);return {...result,dictionary:{...result.dictionary,...(notes.size?{contextNotes:[...notes.values()].slice(-8)}:{})}};}
  async function obtain(word,includeRelations=false,includePronunciations=false){
    const usable=result=>result?.dictionary?.provider==='deepseek'&&(!includeRelations||result.dictionary.relationsVersion===1)&&(!includePronunciations||result.dictionary.pronunciationVersion===1);
    const entry=getStore().detail(word,true);if(usable(entry))return {dictionary:entry.dictionary,audioDataUri:entry.audioDataUri};
    if(usable(explanations.get(word)))return explanations.get(word);
    if(!pending.has(word))pending.set(word,Promise.resolve().then(()=>lookup(word)).then(result=>{explanations.set(word,result);while(explanations.size>32)explanations.delete(explanations.keys().next().value);return result;}).finally(()=>pending.delete(word)));
    return pending.get(word);
  }
  router.use((req,res,next)=>{
    res.set('Cache-Control','no-store');
    if(!localRequest(req)||!allowedOrigin(req))return res.status(403).json({error:'仅允许本机阅读页面访问生词库'});
    if(req.method==='OPTIONS'){
      if(req.get('origin')!=='null'||!['GET','POST'].includes(req.get('access-control-request-method')))return res.sendStatus(403);
      res.set({'Access-Control-Allow-Origin':'null','Access-Control-Allow-Methods':'GET, POST','Access-Control-Allow-Headers':'Authorization, Content-Type','Vary':'Origin'});return res.sendStatus(204);
    }
    if(req.path==='/session'){
      if(req.method!=='GET'||req.get('origin')==='null'||req.get('sec-fetch-site')==='cross-site'||req.get('x-vocabulary-client')!=='reader')return res.status(403).json({error:'请从本机程序页面连接生词库'});
      return next();
    }
    const token=req.get('authorization')?.replace(/^Bearer /,'');
    if(!getStore().authorize(token))return res.status(401).json({error:'词库连接无效，请在本机程序重新打开阅读页面'});
    if(req.get('origin')==='null')res.set({'Access-Control-Allow-Origin':'null','Vary':'Origin'});
    next();
  });
  router.use(express.json({limit:'32kb'}));
  router.get('/session',(req,res)=>res.json({token:getStore().issueCapability(),baseUrl:`http://127.0.0.1:${req.socket.localPort}`}));
  router.get('/words',(req,res)=>res.json({words:getStore().list()}));
  router.get('/words/:word',(req,res,next)=>{try{const entry=getStore().detail(req.params.word);if(!entry)return res.status(404).json({error:'这个单词尚未收录'});res.json({entry});}catch(error){next(error);}});
  router.post('/words',(req,res,next)=>{try{const added=getStore().add(req.body||{});res.status(added.created?201:200).json(added);}catch(error){next(error);}});
  router.post('/undo',(req,res,next)=>{try{res.json(getStore().undo(req.body?.actionId));}catch(error){next(error);}});
  router.post('/words/:word/remove',(req,res,next)=>{try{res.json(getStore().remove(req.params.word));}catch(error){next(error);}});
  router.post('/eudic',async(req,res)=>{
    let word;try{word=normalizeWord(req.body?.word);}catch{return res.status(400).json({error:'请选择一个英文单词'});}
    if(!eudicShortcut)return res.json({sent:false});
    if(shortcutBusy)return res.status(429).json({error:'欧路快捷搜索正在处理，请稍后双击'});
    shortcutBusy=true;try{res.json(await eudicShortcut(word));}catch(error){const messages={EUDIC_NOT_FOREGROUND:'发送时浏览器不在前台，已取消欧路快捷键；请回到阅读窗口再双击',EUDIC_WINDOW_CHANGED:'复制期间前台窗口发生变化，已取消第二次快捷键；请稍后再双击',EUDIC_COPY_MISMATCH:'复制内容与当前词不一致，已取消欧路快捷键；请回到查词窗口再双击',EUDIC_CLIPBOARD_BUSY:'剪贴板暂时被占用，请稍后再双击',EUDIC_TIMEOUT:'欧路快捷键辅助启动超时，请稍后再双击'};res.status(503).json({error:(messages[error.code]||'无法发送欧路快捷键')+'，网页查词仍可使用'});}finally{shortcutBusy=false;}
  });
  router.post('/context',async(req,res)=>{
    let word,context;try{word=normalizeWord(req.body?.word);context=validateContext(req.body?.context);}catch{return res.status(400).json({error:'请选择英文单词，原句不得为空或超过 2000 字符'});}
    try{const key=JSON.stringify([word,context]);let note=getStore().detail(word,true)?.dictionary?.contextNotes?.find(note=>note.context===context)||contexts.get(key);
      if(!note){if(!contextPending.has(key)){if(contextPending.size>=16)throw Error('busy');contextPending.set(key,Promise.resolve().then(()=>contextLookup(word,context)).then(note=>{contexts.set(key,note);while(contexts.size>32)contexts.delete(contexts.keys().next().value);return note;}).finally(()=>contextPending.delete(key)));}note=await contextPending.get(key);}
      const entry=getStore().detail(word);if(entry?.dictionary)getStore().updateLookup(word,withNotes(word,{dictionary:entry.dictionary,audioDataUri:entry.audioDataUri}));res.json({note});
    }catch{res.status(503).json({error:'原句英文解释暂时不可用，通用词义仍可阅读，请稍后重试'});}
  });
  router.post('/explain',async(req,res,next)=>{try{const word=normalizeWord(req.body?.word);const result=withNotes(word,await obtain(word,req.body?.includeRelations===true,req.body?.includePronunciations===true));if((req.body?.includeRelations===true&&result.dictionary?.relationsVersion!==1)||(req.body?.includePronunciations===true&&result.dictionary?.pronunciationVersion!==1))throw Object.assign(new Error('Incomplete dictionary supplement'),{code:'DICTIONARY_FORMAT_INVALID'});const store=getStore();if(store.detail(word))store.updateLookup(word,result);res.json({entry:{word,...result}});}catch(error){const messages={DICTIONARY_FORMAT_INVALID:'DeepSeek 返回的释义格式不完整或无效，已有释义已保留，请重试补查。',DEEPSEEK_API_KEY_MISSING:'当前程序未配置 DeepSeek API Key，请检查配置后重启。',DEEPSEEK_AUTH_FAILED:'DeepSeek 鉴权失败，请检查 API Key 后重启。',DEEPSEEK_QUOTA_EXCEEDED:'DeepSeek 账户余额不足，请补充余额后重试。'};res.status(503).json({error:messages[error.code]||(error.name==='AbortError'?'DeepSeek 查询超时，已有释义已保留，请稍后重试。':'DeepSeek 释义暂时不可用，请稍后重试；查看释义不会自动收录单词')});}});
  router.post('/words/:word/lookup',async(req,res,next)=>{
    try{
      const store=getStore(),entry=store.detail(req.params.word);if(!entry)return res.status(404).json({error:'这个单词尚未收录'});
      if(entry.dictionary?.provider==='deepseek'){const merged=withNotes(entry.word,{dictionary:entry.dictionary,audioDataUri:entry.audioDataUri});if(JSON.stringify(merged.dictionary.contextNotes)!==JSON.stringify(entry.dictionary.contextNotes))store.updateLookup(entry.word,merged);return res.json({entry:store.detail(entry.word)});}
      try{store.updateLookup(entry.word,withNotes(entry.word,await obtain(entry.word)));}
      catch(error){const safeCodes=['DEEPSEEK_API_KEY_MISSING','DEEPSEEK_AUTH_FAILED','DEEPSEEK_QUOTA_EXCEEDED'];store.updateLookup(entry.word,{error:safeCodes.includes(error.code)?error.message+' 单词已保存，可稍后补查。':'DeepSeek 释义暂时不可用，单词已保存，可稍后补查'});}
      res.json({entry:store.detail(entry.word)});
    }catch(error){next(error);}
  });
  router.use((error,req,res,next)=>res.status(400).json({error:error.type==='entity.too.large'?'词库请求超过大小限制':/单词|原句|文章来源|撤销|词典|发音/.test(error.message||'')?error.message:'无法完成词库操作，请检查输入后重试'}));
  return router;
}
module.exports={createVocabularyRouter,localRequest};
