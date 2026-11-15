'use strict';
const express=require('express');
const {parseEpub}=require('./epubParser');
const {needsAiDirectory,createDirectoryService}=require('./epubAiDirectory');
function summary({id,title,depth=0,kind,text,group,images,evidence}){
  return {id,title,depth,kind,group:!!group,words:text?text.split(/\s+/).length:0,images:(images||[]).length,...(evidence?{evidence}:{})};
}
function describe(bookId,entry){
  const {book,download}=entry,chapters=book.chapters.map(summary);
  const uncoveredPaths=new Set(book.navigation.coverage.uncovered.map(range=>range.path));
  const items=book.readingItems.map(doc=>{
    const sourceContents=doc.kind==='navigation'&&book.navigation.status!=='ai-generated';
    return {...summary(doc),title:sourceContents?'原书目录页':doc.title,separate:sourceContents||doc.kind==='unlisted'||uncoveredPaths.has(doc.path)};
  });
  return {bookId,title:book.title,tocSource:book.tocSource,chapters,integrity:book.integrity,
    navigation:{status:book.navigation.status,source:book.navigation.source,repaired:book.navigation.repaired,entries:chapters,candidates:book.navigation.candidates.map(summary),warnings:book.navigation.warnings,coverage:book.navigation.coverage},
    reading:{words:items.reduce((sum,item)=>sum+item.words,0),items},
    aiDirectory:download?{state:'ready',downloadUrl:'/outputs/'+encodeURIComponent(download)}:
      book.navigation.status==='ai-generated'?{state:'embedded'}:
      needsAiDirectory(book)?{state:'needed'}:{state:'not-needed'}};
}
function foreignOrigin(req){
  const origin=req.get('origin');
  return !!(origin&&origin!=='http://'+req.get('host'))||req.get('sec-fetch-site')==='cross-site';
}
function createEpubDirectoryRouter({bookStore,outputDir,upload,callModel,sessionStore,runtime}){
  const router=express.Router(),service=createDirectoryService({outputDir,callModel});
  async function loadBook(bookId){
    if(bookStore.has(bookId)){const entry=bookStore.get(bookId);entry.time=Date.now();return entry;}
    let source;try{source=await sessionStore.readBook(bookId);}catch(error){if(error.code==='ENOENT'||error.status===400)return null;throw error;}
    let book=parseEpub(source),download=null;
    if(needsAiDirectory(book)||book.navigation.status==='ai-generated'){const cached=await service.cached(source);if(cached){book=cached.book;download=cached.filename;}}
    const entry={book,time:Date.now(),source,download};bookStore.set(bookId,entry);return entry;
  }
  router.get('/book/:bookId',async(req,res)=>{
    if(foreignOrigin(req))return res.status(403).json({error:'请从本机阅读页面恢复书籍'});
    try{const entry=await loadBook(req.params.bookId);if(!entry)return res.status(404).json({error:'找不到已保存的原书，请重新上传 EPUB 文件'});res.json(describe(req.params.bookId,entry));}
    catch{res.status(500).json({error:'无法恢复原书，保存文件已保留'});}
  });
  router.get('/ai-directory/status/:bookId',async(req,res)=>{
    if(foreignOrigin(req))return res.status(403).json({error:'请从本机阅读页面查询进度'});
    let entry;try{entry=await loadBook(req.params.bookId);}catch{return res.status(500).json({error:'无法恢复书籍状态'});}
    if(!entry)return res.status(404).json({error:'书籍会话已过期'});
    entry.time=Date.now();res.json(entry.progress||{phase:entry.download?'complete':'idle',current:0,total:0});
  });
  router.post('/toc',(req,res,next)=>foreignOrigin(req)?res.status(403).json({error:'请从本机阅读页面上传文件'}):runtime?.readerRestarting?res.status(503).json({error:'阅读器正在更新，请等待页面重新连接'}):next(),upload.single('file'),async(req,res)=>{
    if(runtime?.readerRestarting)return res.status(503).json({error:'阅读器正在更新，请等待页面重新连接'});
    if(runtime)runtime.analysisActive++;
    try{
      if(!req.file)throw new Error('请上传 EPUB 文件');
      let book=parseEpub(req.file.buffer),download=null;
      const eligible=needsAiDirectory(book);
      if(eligible||book.navigation.status==='ai-generated'){const cached=await service.cached(req.file.buffer);if(cached){book=cached.book;download=cached.filename;}}
      const bookId=await sessionStore.saveBook(req.file.buffer),entry={book,time:Date.now(),source:req.file.buffer,download};
      bookStore.set(bookId,entry);
      while(bookStore.size>5)bookStore.delete(bookStore.keys().next().value);
      res.json(describe(bookId,entry));
    }catch(error){res.status(400).json({error:error.message});}
    finally{if(runtime)runtime.analysisActive--;}
  });
  router.post('/ai-directory',async(req,res)=>{
    if(req.get('x-reader-client')!=='epub-ai-directory'||foreignOrigin(req)){
      return res.status(403).json({error:'请从本机阅读页面生成目录'});
    }
    if(runtime?.readerRestarting)return res.status(503).json({error:'阅读器正在更新，请等待当前页面重新连接'});
    if(runtime)runtime.analysisActive++;
    try{
    const bookId=String(req.body.bookId||'');let entry;
    try{entry=await loadBook(bookId);}catch{return res.status(500).json({error:'无法恢复原书，保存文件已保留'});}
    if(!entry)return res.status(404).json({error:'书籍会话已过期，请重新上传 EPUB 文件'});
    if(entry.download||entry.book.navigation.status==='ai-generated')return res.json(describe(bookId,entry));
    if(!entry.source||!needsAiDirectory(entry.book))return res.status(409).json({error:'这份文件已有目录或目录仍需核对，未自动覆盖'});
    entry.time=Date.now();
    try{
      entry.progress={phase:'preparing',current:0,total:0};
      const result=await service.generate(entry.source,{onProgress:progress=>{entry.progress=progress;entry.time=Date.now();}});
      entry.book=result.book;entry.download=result.filename;entry.time=Date.now();
      entry.progress={...entry.progress,phase:'complete'};
      bookStore.set(bookId,entry);
      res.json(describe(bookId,entry));
    }catch(error){
      const safe=/^(?:EPUB|AI |正文|单段|另一本|DeepSeek|未配置|生成的|现有目录)/.test(error.message)?error.message:'AI 目录生成失败，原文已保留；请稍后重试';
      entry.progress={...entry.progress,phase:'failed'};
      const retryable=!/^(?:EPUB|正文没有|生成的 EPUB)/.test(safe);
      res.status(502).json({error:safe,retryable});
    }
    }finally{if(runtime)runtime.analysisActive--;}
  });
  router.loadBook=loadBook;
  return router;
}
module.exports={createEpubDirectoryRouter};
