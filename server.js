// Load project configuration before modules capture model credentials.
require('dotenv').config({path:require('node:path').join(__dirname,'.env')});
const {lookupContext}=require('./services/contextDictionary');
const express = require('express');
const multer = require('multer');
const path = require('path');
const { splitText } = require('./services/textSplitter');
const paragraphService = require('./services/paragraphSplitter');
const analysisService = require('./services/deepseek');
const { parseAnalysis } = require('./services/orderedAnalysis');
const {analyzeValidated} = require('./services/validatedAnalysis');
const diagramService = require('./services/plantumlRenderer');
const html = require('./services/htmlBuilder');
const { saveResult } = require('./services/resultPersistence');
const { parseEpub } = require('./services/epubParser');
const { attachImages } = require('./public/studyShared');
const { normalizeOriginal } = require('./public/epubOriginal');
const crypto = require('node:crypto');
const {VocabularyStore} = require('./services/vocabularyStore');
const {sendEudicShortcut}=require('./services/eudicShortcut');
const {createVocabularyRouter,localRequest} = require('./services/vocabularyRoutes');
const {lookupWord} = require('./services/dictionaryService');
const {ReaderSessionStore,JOB_ID,requireId} = require('./services/readerSessionStore');
const {createReaderSessionRouter,loadSavedResult,sameOrigin} = require('./services/readerSessionRoutes');

function assertTextPreserved(before,after){
  const normalize=value=>String(value).replace(/\s+/g,' ').trim();
  if(typeof after!=='string'||normalize(before)!==normalize(after))throw new Error('正文完整性校验失败：分段前后文字不一致，已停止处理，未保存不完整结果');
}
function sectionsFromText(text) {
  const sections = [];
  for (const item of splitText(text)) {
    if (item.type === 'paragraph') sections.push({paragraph:item.text, sentences:[]});
    else sections.at(-1).sentences.push({text:item.my_sentence, start:item.start, end:item.end});
  }
  assertTextPreserved(text,sections.map(section=>section.paragraph).join('\n\n'));
  return sections;
}
function createApp(options = {}) {
  const app = express();
  app.use((req,res,next)=>localRequest(req)?next():res.status(403).json({error:'仅允许本机访问阅读程序'}));
  const prepareParagraphs = options.prepareParagraphs || paragraphService.prepareParagraphs;
  const analyzeSentence = options.analyzeSentence || analysisService.analyzeSentence;
  const renderDiagram = options.renderDiagram || diagramService.renderDiagram;
  const outputDir = options.outputDir || path.join(__dirname, 'outputs');
  const sessionStore = new ReaderSessionStore(options.sessionDir || (options.outputDir?path.resolve(outputDir)+'-reader-session':path.join(__dirname,'data','reader-session')));
  const activeJobs = new Set();
  app.locals.analysisActive=0;
  let vocabularyStore=options.vocabularyStore||null;
  const getVocabulary=()=>vocabularyStore ||= new VocabularyStore(options.vocabularyPath || path.join(options.outputDir?outputDir:path.join(__dirname,'data'),'vocabulary.sqlite'));
  app.locals.closeVocabulary=()=>{vocabularyStore?.close();vocabularyStore=null;};
  app.use('/api/vocabulary',createVocabularyRouter({getStore:getVocabulary,eudicShortcut:options.eudicShortcut===undefined?(options.dictionaryLookup?null:sendEudicShortcut):options.eudicShortcut,lookup:options.dictionaryLookup||lookupWord,contextLookup:options.contextLookup||(options.dictionaryLookup?async()=>{throw new Error('Context lookup was not provided by this integration');}:lookupContext)}));
  const delayMs = options.delayMs ?? 300;
  const resultStore = new Map();
  const bookStore = new Map();
  const maxTextBytes = 10 * 1024 * 1024;
  // fieldSize covers pasted text plus base64 EPUB illustrations on /api/process.
  const upload = multer({storage:multer.memoryStorage(), limits:{fileSize:20 * 1024 * 1024, files:1, fields:5, parts:6, fieldSize:30 * 1024 * 1024}, fileFilter(req,file,callback) {
    callback(null, ['.txt','.pdf','.epub'].includes(path.extname(file.originalname).toLowerCase()));
  }});
  // Novels often embed images, so EPUB uploads allow a larger payload.
  const epubUpload = multer({storage:multer.memoryStorage(), limits:{fileSize:100 * 1024 * 1024, files:1, fields:2, parts:3}, fileFilter(req,file,callback) {
    callback(null, path.extname(file.originalname).toLowerCase() === '.epub');
  }});
  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/outputs', express.static(outputDir, {index:false}));
  app.use('/output', express.static(path.join(__dirname,'output'), {index:false}));
  app.use(express.json({limit:'10mb'}));
  app.use(express.urlencoded({extended:true, limit:'10mb'}));
  app.use((req,res,next) => {
    for (const [id, entry] of resultStore) if (Date.now() - entry.time > 10 * 60 * 1000) resultStore.delete(id);
    for (const [id, entry] of bookStore) if (Date.now() - entry.time > 30 * 60 * 1000) bookStore.delete(id);
    next();
  });
  app.get('/api/health', (req,res) => res.json({app:'sentence-process', status:'ok'}));
  app.use('/api/reader',require('./services/readerLifecycle').createReaderLifecycle(app));
  app.use('/api',createReaderSessionRouter({
    store:sessionStore,outputDir,activeJobs,getVocabulary,runtime:app.locals,
    cachedBookTitle:bookId=>bookStore.get(bookId)?.book.title,
    baseUrl:req=>`http://127.0.0.1:${req.socket.localPort}`
  }));
  app.use('/api/passage-recap', require('./services/passageRecap').createRecapRouter({
    outputDir, model:options.recapModel || analysisService.callDeepSeek, authorize:token=>getVocabulary().authorize(token)
  }));
  const epubRouter=require('./services/epubDirectoryRoutes').createEpubDirectoryRouter({bookStore,outputDir,upload:epubUpload,callModel:options.directoryModel,sessionStore,runtime:app.locals});
  app.use('/api/epub',epubRouter);
  app.post('/api/epub/chapter', async(req,res) => {
    let entry;try{entry=await epubRouter.loadBook(String(req.body.bookId||''));}catch{return res.status(500).json({error:'无法恢复原书，保存文件已保留'});}
    if (!entry) return res.status(404).json({error:'书籍会话已过期，请重新上传 EPUB 文件'});
    entry.time = Date.now();
    const mode=req.body.mode||'chapter';
    if(!['chapter','candidate','reading'].includes(mode))return res.status(400).json({error:'无效的 EPUB 载入方式'});
    const available=mode==='reading'?entry.book.readingItems:mode==='candidate'?entry.book.navigation.candidates:entry.book.chapters;
    const ids = mode==='reading'&&(!req.body.ids||!req.body.ids.length)&&req.body.id==null
      ? available.map(item=>item.id)
      : Array.isArray(req.body.ids) ? req.body.ids.map(String) : [String(req.body.id ?? '')];
    for (const id of ids) {
      if (!available.some(item => item.id === id)) {
        return res.status(404).json({error:'目录中没有这个章节，请重新上传 EPUB 文件'});
      }
    }
    // Chapters are delivered in table-of-contents order, however the client picked them.
    const selected = available.filter(item => ids.includes(item.id) && (item.text||(mode==='reading'&&item.images?.length)));
    if (!selected.length) return res.status(404).json({error:'所选条目没有可读取的正文，请改选章节'});
    const text = selected.map(chapter => chapter.text).join('\n\n');
    if (Buffer.byteLength(text, 'utf8') > maxTextBytes) return res.status(400).json({error:'所选章节合计超过 10 MB，请少选几章'});
    const resources = Object.create(null);
    for (const chapter of selected) for (const part of chapter.originalParts || [chapter.original]) for (const name of part?.resourcePaths || []) {
      if (Object.hasOwn(entry.book.originalResources,name)) resources[name] = entry.book.originalResources[name];
    }
    let original;
    try {original=normalizeOriginal({chapters:selected.flatMap(chapter=>(chapter.originalParts||[chapter.original]).map(part=>({...part,title:chapter.title}))),resources});}
    catch (error) {return res.status(400).json({error:error.message});}
    res.json({
      title:mode==='reading'?(req.body.id==null?'书内阅读预览（可能含书前、书后资料）':selected[0].title):mode==='candidate'?`待核对标题：${selected[0].title}`:selected.length>1?`${selected.length} 个目录条目合并`:selected[0].title,
      text,
      images:selected.flatMap(chapter => chapter.images || []),
      original,
    });
  });
  async function inputText(req) {
    let text = '';
    if (req.file) {
      const extension = path.extname(req.file.originalname).toLowerCase();
      if (extension === '.epub') throw new Error('EPUB 文件请先在目录面板中选择一个章节，再开始分析');
      text = extension === '.pdf'
        ? (await require('pdf-parse')(req.file.buffer)).text
        : req.file.buffer.toString('utf8');
    } else if (typeof req.body.text === 'string') text = req.body.text;
    if (!text.trim()) throw new Error('请粘贴文本或上传有效的 TXT / PDF 文件');
    if (Buffer.byteLength(text, 'utf8') > maxTextBytes) throw new Error('提取后的文本不能超过 10 MB，请分批处理');
    return text;
  }
  app.post('/api/preview', upload.single('file'), async (req,res) => {
    if(!sameOrigin(req))return res.status(403).json({error:'请从本机阅读页面整理文本'});
    if(app.locals.readerRestarting)return res.status(503).json({error:'阅读器正在更新，请等待当前页面重新连接'});
    app.locals.analysisActive++;
    try {
      const source=await inputText(req);
      const result = await prepareParagraphs(source, {mode:req.body.paragraphMode || 'pdf'});
      assertTextPreserved(source,result.text);
      res.json({...result, sections:sectionsFromText(result.text)});
    } catch (error) { res.status(400).json({error:error.message}); }
    finally {app.locals.analysisActive--;}
  });
  function sse(res,event,data) { if (!res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
  app.post('/api/process', upload.single('file'), async (req,res) => {
    if(!sameOrigin(req))return res.status(403).json({error:'请从本机阅读页面分析文本'});
    if(app.locals.readerRestarting)return res.status(503).json({error:'阅读器正在更新，请等待当前页面重新连接'});
    let job,locked=false,counted=false,streaming=false;
    function beginStream(){
      if(streaming)return;
      res.writeHead(200, {'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});
      res.flushHeaders();streaming=true;
    }
    async function checkpoint(index,value){
      try{await sessionStore.saveSentence(job.jobId,index,value);}
      catch{throw Object.assign(new Error('无法保存分析进度，已停止处理，请检查本地磁盘后继续'),{code:'CHECKPOINT_FAILED'});}
    }
    try {
      let request;
      if(req.body.jobId){
        const jobId=requireId(req.body.jobId,JOB_ID);
        if(activeJobs.has(jobId))return res.status(409).json({error:'这项分析仍在进行，请等待原页面完成'});
        activeJobs.add(jobId);locked=true;app.locals.analysisActive++;counted=true;
        job=await sessionStore.readJob(jobId);
        if(job.status==='complete'){
          const saved=await loadSavedResult(outputDir,job.filename);
          saved.vocabulary={...getVocabulary().snapshot(),token:getVocabulary().issueCapability(),baseUrl:`http://127.0.0.1:${req.socket.localPort}`};
          resultStore.set(job.resultId,{...saved,time:Date.now()});beginStream();
          sse(res,'job',{jobId});sse(res,'complete',{resultId:job.resultId,filename:job.filename});return;
        }
        request=await sessionStore.readJobRequest(jobId);
      }else{
        app.locals.analysisActive++;counted=true;
        let article=await inputText(req);const warnings=[];
        if(req.body.reviewed!==true&&req.body.reviewed!=='true'){
          beginStream();sse(res,'progress',{step:'ai_para',message:'正在修复段落边界…'});
          const prepared=await prepareParagraphs(article,{mode:req.body.paragraphMode||'pdf'});
          assertTextPreserved(article,prepared.text);article=prepared.text;warnings.push(...prepared.warnings);
        }
        const sections=sectionsFromText(article);
        const original=req.body.original?normalizeOriginal(JSON.parse(req.body.original)):null;
        if(typeof req.body.images==='string'&&req.body.images.trim()){
          let images=[];try{images=JSON.parse(req.body.images);}catch{}
          const unmatched=attachImages(sections,images);
          if(unmatched)warnings.push(`${unmatched} 张插图无法定位或格式不支持，已省略`);
        }
        if(!sections.some(section=>section.sentences.length))throw new Error('没有可分析的文本');
        request={article,sections,original,warnings};
        job=await sessionStore.createJob(request);
        activeJobs.add(job.jobId);locked=true;
      }
      const {article,sections,original,warnings}=request,total=job.total;
      job.status='running';await sessionStore.saveJob(job);beginStream();sse(res,'job',{jobId:job.jobId});
      sse(res,'progress',{step:'split',message:`拆分完成：${sections.length} 个段落，${total} 个句子`,warnings});
      let current = 0;
      for (const section of sections) {
        for (const sentence of section.sentences) {
          if (res.destroyed) return;
          const index=current++;
          const previous=await sessionStore.readSentence(job.jobId,index);
          if(previous?.completed){Object.assign(sentence,previous.sentence);continue;}
          if (current > 1 && delayMs) await new Promise(resolve=>setTimeout(resolve,delayMs));
          sse(res,'progress',{step:'sentence',current,total,text:sentence.text.slice(0,80),status:'analyzing'});
          let stage = 'analysis',analysis=previous?.analysis;
          try {
            if(!analysis){
              analysis=await analyzeValidated(sentence.text,analyzeSentence,reason=>{
                stage='validation';sse(res,'progress',{step:'sentence',current,total,text:sentence.text.slice(0,80),status:'correcting',message:`[${current}/${total}] ${reason}，正在自动校正一次…`});
              });
              await checkpoint(index,{analysis,completed:false});
            }
            sentence.translation = analysis.translation;
            stage = 'rendering';
            sse(res,'progress',{step:'sentence',current,total,text:sentence.text.slice(0,80),status:'rendering'});
            const diagram = await renderDiagram(analysis.code);
            if (diagram) sentence.diagram = {base64:diagram.buffer.toString('base64'),mimeType:diagram.mimeType};
            else sentence.html = html.buildErrorHtml(sentence.text, '本地画图失败，请检查 Java / PlantUML 或重试');
          } catch (error) {
            if (['CHECKPOINT_FAILED','DEEPSEEK_API_KEY_MISSING','DEEPSEEK_AUTH_FAILED','DEEPSEEK_QUOTA_EXCEEDED'].includes(error.code)) throw error;
            sentence.html = html.buildErrorHtml(sentence.text, stage === 'rendering'
              ? '本地画图失败，请检查 Java / PlantUML 或重试'
              : error.code === 'ANALYSIS_VALIDATION_FAILED' ? error.message+'，已跳过绘图'
              : '语法分析服务调用失败，请检查网络或重试');
          }
          await checkpoint(index,{analysis,completed:true,sentence});
          job.completed=current;await sessionStore.saveJob(job);
        }
      }
      const vocabulary={...getVocabulary().snapshot(),token:getVocabulary().issueCapability(),baseUrl:`http://127.0.0.1:${req.socket.localPort}`};
      assertTextPreserved(article,sections.map(section=>section.paragraph).join('\n\n'));
      const saved = await saveResult({sections, original, vocabulary, outputDir});
      resultStore.set(saved.resultId, {...saved,time:Date.now()});
      job={...job,status:'complete',completed:total,filename:saved.filename,resultId:saved.resultId};
      await sessionStore.saveJob(job);
      sse(res, 'complete', {resultId:saved.resultId,filename:saved.filename});
    } catch (error) {
      if(!streaming&&req.body.jobId)return res.status(error.status||(error.code==='ENOENT'?404:500)).json({error:error.status?error.message:'找不到可续接的分析记录'});
      beginStream();sse(res,'error',{message:error.code==='CHECKPOINT_FAILED'?error.message:/^(?:EPUB|正文|请|提取|没有|DeepSeek|未配置)/.test(error.message)?error.message:'无法完成或保存分析，请检查本地文件后重试'});
    }
    finally {
      if(locked){
        activeJobs.delete(job?.jobId||req.body.jobId);
        if(job&&job.status!=='complete'){job.status='interrupted';try{await sessionStore.saveJob(job);}catch{}}
      }
      if(counted)app.locals.analysisActive--;
      if(!res.writableEnded)res.end();
    }
  });
  app.get('/api/result/:id', (req,res) => {
    const entry = resultStore.get(req.params.id);
    if (!entry) return res.status(404).json({error:'会话结果已过期；已保存的 HTML 仍可从 outputs 文件夹打开'});
    res.json({html:req.query.view==='reader'?undefined:entry.html,sections:entry.sections,original:entry.original,vocabulary:entry.vocabulary,filename:entry.filename,outputUrl:`/outputs/${encodeURIComponent(entry.filename)}`});
  });
  app.use((error,req,res,next) => {
    if (res.headersSent) return next(error);
    res.status(400).json({error:error.code === 'LIMIT_FILE_SIZE' ? '文件超出大小限制（TXT / PDF 不超过 20 MB，EPUB 不超过 100 MB）' : '无法读取上传内容，请检查文件格式和大小'});
  });
  return app;
}
if (require.main === module) {
  const args = process.argv.slice(2);
  const flag = args.find(arg => arg.startsWith('--port=')) || (args[args.indexOf('--port') + 1] || '');
  const PORT = Number(flag.replace('--port=', '')) || process.env.PORT || 3456;
  const server = createApp().listen(PORT, '127.0.0.1', () => console.log(`Server running at http://localhost:${PORT}`));
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${PORT} is already in use.` : 'Server failed to start.'); process.exitCode = 1; });
}
module.exports = { createApp };
