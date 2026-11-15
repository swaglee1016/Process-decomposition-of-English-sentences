'use strict';
const byId = id => document.getElementById(id);
const inputBar=byId('inputBar'), inputBarHeader=byId('inputBarHeader'), inputArrow=byId('inputArrow');
const textInput=byId('textInput'), fileInput=byId('fileInput'), fileBtn=byId('fileBtn'), fileName=byId('fileName'), dropZone=byId('dropZone');
const processBtn=byId('processBtn'), progressBar=byId('progressBar'), statusText=byId('statusText');
const dualPanel=byId('dualPanel'), panelRight=byId('panelRight'), leftContent=byId('leftContent'), rightContent=byId('rightContent');
const timeEstimate=byId('timeEstimate'), downloadBtn=byId('downloadBtn'), savePath=byId('savePath');
const paragraphMode=byId('paragraphMode'), previewPanel=byId('previewPanel'), previewContent=byId('previewContent'), analyzeBtn=byId('analyzeBtn'), undoPreview=byId('undoPreview');
const previewToggle=byId('previewToggle'), previewToggleArrow=byId('previewToggleArrow');
const epubPanel=byId('epubPanel'), epubTitle=byId('epubTitle'), epubToc=byId('epubToc'), loadSelectedBtn=byId('loadSelectedBtn');
const epubToggle=byId('epubToggle'), epubToggleArrow=byId('epubToggleArrow');
const recentReading=byId('recentReading'),recentReadingItems=byId('recentReadingItems'),recentReadingStatus=byId('recentReadingStatus');
function setEpubCollapsed(collapsed){
  epubPanel.classList.toggle('collapsed',collapsed);
  epubToggle.setAttribute('aria-expanded',String(!collapsed));
  epubToggleArrow.textContent=collapsed?'▼':'▲';
}
epubToggle.addEventListener('click',()=>setEpubCollapsed(!epubPanel.classList.contains('collapsed')));
function setPreviewCollapsed(collapsed){
  previewPanel.classList.toggle('collapsed',collapsed);
  previewToggle.setAttribute('aria-expanded',String(!collapsed));
  previewToggleArrow.textContent=collapsed?'▼':'▲';
}
previewToggle.addEventListener('click',()=>setPreviewCollapsed(!previewPanel.classList.contains('collapsed')));
function setInputExpanded(expanded){
  inputBar.classList.toggle('expanded',expanded);
  inputBarHeader.setAttribute('aria-expanded',String(expanded));
  inputArrow.textContent=expanded?'▲':'▼';
}
byId('collapsePanelsBtn').addEventListener('click',()=>{
  setInputExpanded(false);setEpubCollapsed(true);setPreviewCollapsed(true);recentReading.open=false;
});
let outputUrl='', sectionsData=[], preview=null, history=[], revision=0, busy=false;
let epubBook=null, epubSourceFile=null, activeChapterId=null, chapterImages=[], chapterOriginal=null, resultOriginal=null;
let loadedIds=[],loadedMode='chapter',analysisJobId='',workspaceSession=null,selectedSentence=null;
const selectedIds=new Set();
function formatTime(ms){const seconds=Math.round(ms/1000);return seconds>=60?`${Math.floor(seconds/60)}分${seconds%60}秒`:`${seconds}秒`;}
function invalidate(){revision++;preview=null;history=[];previewPanel.hidden=true;analyzeBtn.disabled=true;analyzeBtn.hidden=false;analysisJobId='';if(byId('resumeAnalysisBtn'))byId('resumeAnalysisBtn').hidden=true;}
function clearEpub(){epubBook=null;epubSourceFile=null;activeChapterId=null;loadedIds=[];loadedMode='chapter';chapterImages=[];chapterOriginal=null;selectedIds.clear();epubPanel.hidden=true;epubToc.replaceChildren();updateSelectedButton();}
function isEpubFile(){return !!epubBook||/\.epub$/i.test(fileInput.files[0]?.name||'');}
function epubItemLabel(){return epubBook?.navigation?.status==='single-body-entry'?'正文入口':'目录条目';}
function updateSelectedButton(){const count=selectedIds.size;loadSelectedBtn.disabled=!count||busy;loadSelectedBtn.hidden=!!epubBook&&!epubBook.chapters.length;loadSelectedBtn.textContent=`载入选中${epubItemLabel()}${count?`（${count}）`:''}`;}
function lock(value){
  busy=value;
  [processBtn,analyzeBtn,textInput,fileInput,fileBtn,paragraphMode,undoPreview,loadSelectedBtn,byId('epubAiRetry')].forEach(el=>el.disabled=value);
  epubToc.querySelectorAll('input,button').forEach(el=>el.disabled=value||el.dataset.unavailable==='true');
  [byId('epubReadBtn'),...byId('epubCandidates').querySelectorAll('button'),...byId('epubMaterialList').querySelectorAll('button')].forEach(el=>el.disabled=value||el.dataset.unavailable==='true');
  recentReadingItems.querySelectorAll('button').forEach(el=>el.disabled=value||el.dataset.unavailable==='true');
  if(!value){analyzeBtn.disabled=!preview;undoPreview.disabled=!history.length;updateSelectedButton();}
}
inputBarHeader.addEventListener('click',()=>setInputExpanded(!inputBar.classList.contains('expanded')));
textInput.addEventListener('input',async()=>{
  if(epubBook&&workspaceSession){
    lock(true);
    try{
      if(!await workspaceSession.flush())return;
    }finally{lock(false);}
  }
  clearReadingResult();
  fileInput.value='';fileName.textContent='支持 TXT、PDF、EPUB 小说，也可以拖到这里';clearEpub();invalidate();
});
paragraphMode.addEventListener('change',invalidate);
fileBtn.addEventListener('click',()=>fileInput.click());
async function onFileChosen(){
  const file=fileInput.files[0];
  if(!file||busy)return;
  if(/\.epub$/i.test(file.name))return loadEpubToc(file);
  lock(true);
  try{
    if(workspaceSession&&!await workspaceSession.flush())return;
    fileName.textContent=file.name;textInput.value='';
    clearEpub();invalidate();clearReadingResult();
  }finally{lock(false);}
}
fileInput.addEventListener('change',onFileChosen);
dropZone.addEventListener('dragover',event=>{event.preventDefault();if(!busy)dropZone.classList.add('dragover');});
dropZone.addEventListener('dragleave',()=>dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop',event=>{event.preventDefault();dropZone.classList.remove('dragover');if(busy||!event.dataTransfer.files.length)return;fileInput.files=event.dataTransfer.files;onFileChosen();});
async function loadEpubToc(file){
  if(busy)return;
  lock(true);statusText.textContent='正在解析 EPUB 目录…';
  try{
    if(workspaceSession&&!await workspaceSession.flush())throw new Error('当前进度尚未保存，请稍后再切换。');
    const form=new FormData();form.append('file',file);
    const response=await fetch('/api/epub/toc',{method:'POST',body:form});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||'EPUB 解析失败');
    if(workspaceSession&&data.bookId!==epubBook?.bookId){
      const restored=await workspaceSession.activate(async()=>{
        const saved=await getSessionData('/api/recent-reading/'+encodeURIComponent(data.bookId));
        return saved.hasProgress?saved.state:null;
      });
      if(restored)return;
    }
    if(data.bookId===epubBook?.bookId){
      epubSourceFile=file;statusText.textContent='已在阅读《'+epubBook.title+'》';return;
    }
    clearEpub();invalidate();clearReadingResult();textInput.value='';
    fileName.textContent=file.name;
    epubSourceFile=file;epubBook=data;setEpubCollapsed(false);renderEpubToc();
    if(data.aiDirectory?.state==='needed')await obtainAiDirectory();
    else statusText.textContent='《'+data.title+'》'+byId('epubHint').textContent;
    void workspaceSession?.flush();
  }catch(error){statusText.textContent='错误：'+error.message;}
  finally{lock(false);}
}
async function obtainAiDirectory(){
  if(!epubBook)return;
  const currentBook=epubBook,notice=byId('epubAiStatus');
  notice.hidden=false;notice.textContent='正在用 AI 核对原文并修复目录…完成后可直接选择章节，并下载修复后的 EPUB。';
  byId('epubAiRetry').hidden=true;delete currentBook.directoryError;statusText.textContent=notice.textContent;
  let finished=false,polling=false;
  const timer=setInterval(async()=>{
    if(finished||polling||epubBook!==currentBook)return;polling=true;
    try{
      const response=await fetch('/api/epub/ai-directory/status/'+encodeURIComponent(currentBook.bookId));
      if(!response.ok)return;const progress=await response.json();
      if(finished||epubBook!==currentBook)return;
      if(progress.phase==='verifying')notice.textContent='目录核对完成，正在检查全文完整性并保存 EPUB…';
      else if(progress.total)notice.textContent=`正在${progress.phase==='detail'?'补充读取正文并核对':'核对目录'}：第 ${progress.current} / ${progress.total} 批；原书正文保持不变。`;
      statusText.textContent=notice.textContent;
    }catch{}finally{polling=false;}
  },1500);
  try{
    const response=await fetch('/api/epub/ai-directory',{method:'POST',headers:{'Content-Type':'application/json','X-Reader-Client':'epub-ai-directory'},body:JSON.stringify({bookId:currentBook.bookId})});
    const result=await response.json();if(!response.ok)throw Object.assign(new Error(result.error||'AI 目录生成失败'),{retryable:result.retryable!==false});
    if(epubBook!==currentBook)return;
    epubBook=result;renderEpubToc();statusText.textContent='目录已修复并保存，请点击章节开始阅读。';
  }catch(error){
    if(epubBook!==currentBook)return;
    currentBook.directoryError=error.message;currentBook.directoryRetryable=error.retryable!==false;renderEpubToc();statusText.textContent=notice.textContent;
  }finally{finished=true;clearInterval(timer);}
}
byId('epubAiRetry').addEventListener('click',async()=>{if(busy||!epubBook)return;lock(true);try{await obtainAiDirectory();}finally{lock(false);}});
function renderEpubToc(){
  if(!epubBook)return;
  epubPanel.hidden=false;epubToc.replaceChildren();
  const aiGenerated=epubBook.navigation?.status==='ai-generated';
  const aiRepaired=aiGenerated&&epubBook.navigation.repaired===true;
  epubTitle.textContent='《'+epubBook.title+'》'+(aiRepaired?'章节目录（AI 修复）':aiGenerated?'AI 阅读目录':'章节目录');
  const aiStatus=byId('epubAiStatus'),aiDownload=byId('epubAiDownload');
  aiStatus.hidden=!aiGenerated&&!epubBook.directoryError;aiStatus.textContent=epubBook.directoryError?epubBook.directoryError+(epubBook.directoryRetryable===false?'；重复点击无法解决，可以先阅读全文。':'；可以重试修复目录，或先阅读全文。'):aiRepaired?'已根据原文修复目录；正文保持不变。':aiGenerated?'这是此前生成的阅读小节，未确认为原书章节。':'';
  byId('epubAiRetry').hidden=!epubBook.directoryError||epubBook.directoryRetryable===false;byId('epubAiRetry').textContent='重试修复目录';
  const generatedUrl=epubBook.aiDirectory?.downloadUrl;
  aiDownload.textContent=aiRepaired?'下载修复后的 EPUB':'下载带目录的 EPUB';aiDownload.hidden=!generatedUrl;if(generatedUrl)aiDownload.setAttribute('href',generatedUrl);
  const navigation=epubBook.navigation||{status:'chapters',candidates:[],warnings:[]};
  const messages={
    'ai-generated':aiRepaired?'目录已修复。点击章节载入，或勾选多项一起阅读。':'点击阅读小节载入，或勾选多项一起阅读。',
    'not-found':'未检出有效的分章目录，将由 AI 核对原文并修复。',
    'single-body-entry':'原书只提供一个正文入口，未提供逐章目录。',
    'uncertain':`${navigation.source==='headings'?'条目来自正文章标题识别，尚需核对。':''}目录识别需要核对，将由 AI 结合原文修复；下方仅保留已识别条目。`,
    'chapters':navigation.source==='headings'?'已从正文章标题识别目录。点击章节直接载入。':'点击目录条目直接载入；或勾选多项后一起载入。'
  };
  const verified=epubBook.integrity?.status==='verified'?'全书 '+epubBook.integrity.files+' 个源文件文字核对通过。':'';
  byId('epubHint').textContent=verified+(epubBook.directoryError?'目录修复未完成；当前条目尚未通过完整性核对。':messages[navigation.status]||messages.uncertain);
  const warnings=byId('epubWarnings');warnings.textContent=[...new Set((navigation.warnings||[]).map(w=>w.message))].join('\n');warnings.hidden=!warnings.textContent;
  for(const chapter of epubBook.chapters){
    if(chapter.group){
      const header=document.createElement('div');header.className='epub-group';
      header.style.paddingLeft=(14+chapter.depth*18)+'px';
      header.textContent=chapter.title;epubToc.append(header);continue;
    }
    const item=document.createElement('div');
    item.className='epub-chapter'+(chapter.id===activeChapterId?' active':'');
    item.style.paddingLeft=(8+chapter.depth*18)+'px';
    const check=document.createElement('input');
    check.type='checkbox';check.className='epub-check';
    check.checked=selectedIds.has(chapter.id);check.disabled=busy||!chapter.words;check.dataset.unavailable=String(!chapter.words);
    check.setAttribute('aria-label',`选择 ${chapter.title}`);
    check.addEventListener('click',event=>event.stopPropagation());
    check.addEventListener('change',()=>{
      if(busy)return;
      check.checked?selectedIds.add(chapter.id):selectedIds.delete(chapter.id);
      invalidate();updateSelectedButton();
      statusText.textContent=selectedIds.size?`已选 ${selectedIds.size} 项${epubItemLabel()}，请点击“载入选中${epubItemLabel()}”合并预览`:`请点击${epubItemLabel()}载入，或勾选多项后一起载入`;
    });
    const open=document.createElement('button');
    open.type='button';open.className='epub-chapter-open';open.disabled=busy||!chapter.words;open.dataset.unavailable=String(!chapter.words);
    const label=document.createElement('span');label.className='epub-chapter-title';label.textContent=chapter.title;
    const words=document.createElement('span');words.className='epub-chapter-words';
    words.textContent=(chapter.words?`约 ${chapter.words} 词`:'无文本')+(chapter.images?` · ${chapter.images} 图`:'');
    open.append(label,words);item.append(check,open);
    open.addEventListener('click',()=>selectChapter(chapter));
    epubToc.append(item);
  }
  // Unverified headings and file fragments are evidence for repair, not a second directory.
  const candidatePanel=byId('epubCandidates');candidatePanel.replaceChildren();candidatePanel.hidden=true;
  const reading=epubBook.reading;
  const unlisted=!!navigation.coverage?.uncovered?.length;
  const fallback=!!reading&&(reading.items?.length>0||unlisted||['not-found','single-body-entry','uncertain'].includes(navigation.status));
  byId('epubReading').hidden=!fallback;byId('epubReadBtn').hidden=!fallback;
  byId('epubReadBtn').textContent='阅读全文';byId('epubReadBtn').dataset.unavailable=String(!reading?.words);
  byId('epubReadingHint').textContent=fallback?(unlisted?'含未列入目录的原文，可阅读全文或单独打开相应原页。':'按原书阅读顺序载入全部内容。'):'';
  const materialList=byId('epubMaterialList');materialList.replaceChildren();
  for(const item of reading?.items||[]){
    if(!item.separate||!item.words)continue;
    const button=document.createElement('button');button.type='button';button.className='btn-small';
    button.textContent=item.title+'（约 '+item.words+' 词）';button.disabled=busy;
    button.addEventListener('click',()=>loadChapters([item.id],null,'reading'));materialList.append(button);
  }
  byId('epubMaterials').hidden=!materialList.children.length;
  updateSelectedButton();
}
async function requestChapters(ids,mode='chapter'){
  const request=()=>fetch('/api/epub/chapter',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    bookId:epubBook.bookId,...(mode!=='chapter'?{mode}:{}),...(ids.length===1?{id:ids[0]}:{ids})
  })});
  let response=await request(),data=await response.json();
  if(response.status===404&&/书籍会话已过期/.test(data.error||'')&&epubSourceFile){
    statusText.textContent='正在恢复书籍会话…';
    const form=new FormData();form.append('file',epubSourceFile);
    const restored=await fetch('/api/epub/toc',{method:'POST',body:form});
    const book=await restored.json();
    if(!restored.ok)throw new Error(book.error||'恢复书籍失败，请重新选择 EPUB 文件');
    epubBook=book;
    response=await request();data=await response.json();
  }
  if(!response.ok)throw new Error(data.error||'章节载入失败');
  return data;
}
async function loadChapters(ids,activeId,mode='chapter'){
  if(busy||!epubBook||(!ids.length&&mode!=='reading'))return;
  if(mode!=='chapter')selectedIds.clear();
  invalidate();
  const version=revision;lock(true);statusText.textContent=`正在载入${epubItemLabel()}…`;
  try{
    const data=await requestChapters(ids,mode);
    const form=new FormData();form.append('text',data.text);form.append('paragraphMode','preserve');
    const prepared=await requestPreview(form);
    if(version!==revision)return;
    activeChapterId=activeId;chapterImages=data.images||[];chapterOriginal=data.original||null;preview=prepared;history=[];renderPreview();renderEpubToc();
    loadedIds=[...ids];loadedMode=mode;
    setInputExpanded(false);
    statusText.textContent=`已载入「${data.title}」${chapterImages.length?`（含 ${chapterImages.length} 张插图）`:''}，请检查分段后开始分析`;
  }catch(error){statusText.textContent='错误：'+error.message;}
  finally{lock(false);}
}
function selectChapter(chapter){
  if(busy)return;
  selectedIds.clear();updateSelectedButton();
  return loadChapters([chapter.id],chapter.id);
}
function loadSelectedChapters(){
  if(!epubBook)return;
  return loadChapters(epubBook.chapters.filter(chapter=>selectedIds.has(chapter.id)).map(chapter=>chapter.id),null);
}
loadSelectedBtn.addEventListener('click',loadSelectedChapters);
byId('epubReadBtn').addEventListener('click',()=>loadChapters([],null,'reading'));
async function requestPreview(body){const response=await fetch('/api/preview',{method:'POST',body});const data=await response.json();if(!response.ok)throw new Error(data.error||'分段失败');return data;}
function inputForm(){const form=new FormData();if(fileInput.files[0])form.append('file',fileInput.files[0]);else form.append('text',textInput.value);form.append('paragraphMode',paragraphMode.value);return form;}
function renderPreview(){
  setPreviewCollapsed(false);
  previewPanel.hidden=false;previewContent.replaceChildren();
  byId('previewSummary').textContent=`${preview.sections.length} 个段落，${preview.sections.reduce((n,s)=>n+s.sentences.length,0)} 个句子`;
  byId('previewWarnings').textContent=(preview.warnings||[]).join('\n');
  preview.sections.forEach((section,index)=>{
    const block=document.createElement('div');block.className='preview-paragraph';
    const title=document.createElement('strong');title.textContent=`第 ${index+1} 段 `;block.append(title);
    if(index){const merge=document.createElement('button');merge.textContent='合并上一段';merge.addEventListener('click',()=>editPreview(index,null));block.append(merge);}
    const p=document.createElement('p');
    for(const run of StudyShared.getSentenceRuns(section.paragraph,section.sentences)){
      p.append(document.createTextNode(run.text));
      if(run.index!==null&&run.index<section.sentences.length-1){const split=document.createElement('button');split.className='split-boundary';split.textContent='此处换段';split.setAttribute('aria-label',`在第 ${index+1} 段第 ${run.index+1} 句后换段`);split.addEventListener('click',()=>editPreview(index,section.sentences[run.index].end));p.append(split);}
    }
    block.append(p);previewContent.append(block);
  });
  undoPreview.disabled=!history.length;
}
async function editPreview(index,cut){
  if(busy||!preview)return;
  const before=preview;const paragraphs=preview.sections.map(s=>s.paragraph);
  if(cut===null)paragraphs.splice(index-1,2,paragraphs[index-1]+' '+paragraphs[index]);
  else paragraphs.splice(index,1,paragraphs[index].slice(0,cut).trim(),paragraphs[index].slice(cut).trim());
  const form=new FormData();form.append('text',paragraphs.join('\n\n'));form.append('paragraphMode','preserve');lock(true);
  try{preview=await requestPreview(form);preview.warnings=before.warnings;history.push(before);renderPreview();}catch(error){statusText.textContent=error.message;}finally{lock(false);}
}
undoPreview.addEventListener('click',()=>{if(!busy&&history.length){preview=history.pop();renderPreview();}});
processBtn.addEventListener('click',async()=>{
  if(busy)return;
  if(!textInput.value.trim()&&!fileInput.files[0]){statusText.textContent='请先粘贴文本或选择文件';return;}
  if(isEpubFile()){statusText.textContent=epubBook?(epubBook.chapters.length?`请在下方列表中点击${epubItemLabel()}开始`:'目录尚待修复；可点击“阅读全文”先阅读书内内容。'):'正在解析 EPUB 目录，请稍候…';return;}
  const version=revision;lock(true);processBtn.textContent='正在整理…';statusText.textContent='正在识别 PDF 折行与段落边界…';
  try{const data=await requestPreview(inputForm());if(version!==revision)return;preview=data;history=[];renderPreview();statusText.textContent='分段已整理，请检查后开始分析';}catch(error){statusText.textContent='错误：'+error.message;}finally{lock(false);processBtn.textContent='整理分段并预览';}
});
async function analyzePreview(resume=false){
  if(busy||(!preview&&!resume))return;
  lock(true);analyzeBtn.textContent='分析中…';previewPanel.hidden=true;setInputExpanded(false);
  if(epubBook)setEpubCollapsed(true);
  const start=Date.now();progressBar.style.width='0%';downloadBtn.style.display='none';savePath.textContent='';outputUrl='';
  ReadingWorkspace.unmount();
  leftContent.replaceChildren();rightContent.textContent='正在分析并生成结构图…';
  const form=new FormData();form.append('reviewed','true');
  if(resume)form.append('jobId',analysisJobId);
  else{
    analysisJobId='';
    form.append('text',preview.sections.map(s=>s.paragraph).join('\n\n'));
    if(chapterImages.length)form.append('images',JSON.stringify(chapterImages));
    if(chapterOriginal)form.append('original',JSON.stringify(chapterOriginal));
  }
  if(byId('resumeAnalysisBtn'))byId('resumeAnalysisBtn').hidden=true;
  try{
    const response=await fetch('/api/process',{method:'POST',body:form});if(!response.ok)throw new Error('服务器错误：'+response.status);
    const reader=response.body.getReader(), decoder=new TextDecoder();let buffer='',eventType='',resultId='',filename='',failure='';
    function line(value){
      if(value.startsWith('event:'))eventType=value.slice(6).trim();
      else if(value.startsWith('data:')){
        const data=JSON.parse(value.slice(5));
        if(eventType==='job'){analysisJobId=data.jobId;void workspaceSession?.flush();}
        if(eventType==='complete'){resultId=data.resultId;filename=data.filename||'';}
        if(eventType==='error')failure=data.message;
        if(eventType==='progress'){
          statusText.textContent=data.message||`[${data.current}/${data.total}] ${data.status==='rendering'?'生成结构图':'分析句子'} — ${data.text}`;
          if(data.total){progressBar.style.width=Math.round(data.current/data.total*100)+'%';timeEstimate.textContent=`已用 ${formatTime(Date.now()-start)}`;}
        }
      }else if(!value.trim())eventType='';
    }
    while(true){const chunk=await reader.read();buffer+=chunk.done?decoder.decode():decoder.decode(chunk.value,{stream:true});const lines=buffer.split('\n');buffer=lines.pop();lines.forEach(line);if(chunk.done)break;}
    if(buffer.trim())line(buffer);if(failure)throw new Error(failure);if(!resultId&&!filename)throw new Error('分析连接中断，已保存的句子可以继续分析');
    const resultResponse=await fetch((filename?'/api/saved-result/'+encodeURIComponent(filename):'/api/result/'+encodeURIComponent(resultId))+'?view=reader');const result=await resultResponse.json();if(!resultResponse.ok)throw new Error(result.error||'获取结果失败');
    outputUrl=result.outputUrl;sectionsData=result.sections||[];resultOriginal=result.original||null;renderSections();
    Vocabulary.mount({snapshot:result.vocabulary,source:fileInput.files[0]?.name||'粘贴文章'});
    progressBar.style.width='100%';statusText.textContent=`完成：${sectionsData.length} 个段落，${sectionsData.reduce((n,s)=>n+s.sentences.length,0)} 个句子`;
    timeEstimate.textContent=`总耗时 ${formatTime(Date.now()-start)}`;savePath.textContent=`已永久保存：outputs/${result.filename}`;downloadBtn.style.display='block';
    analysisJobId='';
  }catch(error){statusText.textContent='错误：'+error.message;previewPanel.hidden=false;if(analysisJobId&&byId('resumeAnalysisBtn'))byId('resumeAnalysisBtn').hidden=false;}
  finally{lock(false);analyzeBtn.hidden=!!analysisJobId;analyzeBtn.textContent='确认分段并分析';void workspaceSession?.flush();}
}
analyzeBtn.addEventListener('click',()=>analyzePreview(false));
byId('resumeAnalysisBtn')?.addEventListener('click',()=>analyzePreview(true));
function renderSections(){
  leftContent.replaceChildren();rightContent.replaceChildren();let offset=0;
  for(const section of sectionsData){
    leftContent.insertAdjacentHTML('beforeend',StudyShared.buildParallelParagraph(section,offset));
    for(const sentence of section.sentences){const card=document.createElement('article');card.className='sent-card';card.dataset.section=offset++;card.innerHTML=sentence.html||'';rightContent.append(card);}
  }
  InlineDiagramCanvas.mount(rightContent);
  const epub=EpubOriginal.mount({original:resultOriginal,sections:sectionsData,left:leftContent.parentElement,right:panelRight,
    parallel:leftContent,container:byId('originalContent'),bar:byId('readingModeBar'),toggle:byId('readingModeToggle'),status:byId('readingModeStatus'),header:byId('readingHeader')});
  ReadingWorkspace.mount({filename:outputUrl.split('/').pop(),original:resultOriginal,sections:sectionsData,epub,left:leftContent.parentElement,right:panelRight});
  Vocabulary.mount();
}
byId('columnWidth').addEventListener('input',event=>{dualPanel.style.gridTemplateColumns=event.target.value+'% minmax(0,1fr)';});
downloadBtn.addEventListener('click',()=>{if(outputUrl)window.open(outputUrl,'_blank','noopener');});
Vocabulary.mount();

function clearReadingResult(){
  const hadResult=!!outputUrl||sectionsData.length>0;
  outputUrl='';sectionsData=[];resultOriginal=null;selectedSentence=null;
  savePath.textContent='';timeEstimate.textContent='';progressBar.style.width='0%';downloadBtn.style.display='none';
  if(hadResult){
    ReadingWorkspace.unmount();
    renderSections();
    leftContent.textContent='选择章节或输入文章后可继续阅读。';rightContent.textContent='';
  }
}
async function getSessionData(url){
  if(url.startsWith('/api/saved-result/'))url+='?view=reader';
  const response=await fetch(url,{headers:{'X-Reader-Client':'workspace'}});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||'恢复阅读失败');
  return data;
}
async function openRecentReading(id){
  if(busy||!workspaceSession)return;
  lock(true);
  try{
    await workspaceSession.activate(async()=>(await getSessionData('/api/recent-reading/'+encodeURIComponent(id))).state);
  }catch(error){recentReadingStatus.textContent=error.message;}
  finally{lock(false);}
}
async function renderRecentReading(){
  recentReadingItems.replaceChildren();recentReadingStatus.textContent='正在读取最近阅读…';
  try{
    if(workspaceSession&&!await workspaceSession.flush())throw new Error('当前进度尚未保存，请稍后再打开最近阅读。');
    const {items}=await getSessionData('/api/recent-reading');
    recentReadingStatus.textContent=items.length?'选择一本书或文章继续阅读。':'导入 EPUB 或粘贴文章后，这里会保留阅读进度。';
    for(const item of items){
      const button=document.createElement('button');
      button.type='button';button.className='btn-small recent-reading-item';
      button.dataset.readingId=item.id;button.dataset.unavailable=String(item.current);
      button.disabled=busy||item.current;
      const title=document.createElement('strong');title.textContent=item.title;
      const progress=document.createElement('span');
      const location=[item.chapter,item.sentence?('第 '+item.sentence+' 句'):''].filter(Boolean).join(' · ');
      progress.textContent=[item.current?'正在阅读':'',location||(!item.hasProgress?'暂无阅读进度':'有保存进度')].filter(Boolean).join(' · ');
      button.append(title,progress);
      button.addEventListener('click',()=>openRecentReading(item.id));
      recentReadingItems.append(button);
    }
  }catch(error){recentReadingStatus.textContent=error.message;}
}
recentReading.addEventListener('toggle',()=>{if(recentReading.open)void renderRecentReading();});

function captureWorkspace(){
  const chapter=epubBook?.chapters.find(item=>item.id===(activeChapterId||loadedIds[0]));
  const title=epubBook?.title||'最近粘贴的文章';
  const location=resultOriginal?.chapters?.[0]?.title||chapter?.title||(loadedMode==='reading'&&epubBook?'全文':'');
  return {schema:1,input:{text:epubBook?'':textInput.value,paragraphMode:paragraphMode.value||'preserve'},bookId:epubBook?.bookId||null,
    readingLabel:{title:title.slice(0,256),chapter:location.slice(0,256)},
    selection:{ids:[...selectedIds],activeId:activeChapterId,mode:loadedMode,loadedIds:[...loadedIds]},
    preview:preview?{text:preview.sections.map(s=>s.paragraph).join('\n\n'),warnings:preview.warnings||[]}:null,
    resultFilename:outputUrl?decodeURIComponent(outputUrl.split('/').pop()):null,jobId:analysisJobId||null,
    selectedSentence,scroll:{left:leftContent.parentElement.scrollTop||0,translation:byId('translationPanel')?.scrollTop||0,right:panelRight.scrollTop||0},
    layout:{inputExpanded:inputBar.classList.contains('expanded'),epubCollapsed:epubPanel.classList.contains('collapsed'),
      previewCollapsed:previewPanel.classList.contains('collapsed'),columnWidth:Number(byId('columnWidth').value)||40}};
}
async function restoreWorkspace(state){
  lock(true);
  const get=getSessionData;
  try{
    textInput.value=state.input?.text||'';paragraphMode.value=state.input?.paragraphMode||'preserve';
    if(state.bookId){
      epubBook=await get('/api/epub/book/'+encodeURIComponent(state.bookId));
      fileName.textContent=epubBook.title+' · 已恢复原书';
      const selection=state.selection||{};
      selectedIds.clear();for(const id of selection.ids||[])selectedIds.add(id);
      activeChapterId=selection.activeId??null;loadedIds=selection.loadedIds||[];loadedMode=selection.mode||'chapter';
      renderEpubToc();
      if(state.preview){
        const chapter=await requestChapters(loadedIds,loadedMode);
        chapterImages=chapter.images||[];chapterOriginal=chapter.original||null;
      }
    }
    if(state.preview){
      const form=new FormData();form.append('text',state.preview.text);form.append('paragraphMode','preserve');
      preview=await requestPreview(form);preview.warnings=state.preview.warnings||[];history=[];renderPreview();
    }
    if(state.resultFilename){
      const result=await get('/api/saved-result/'+encodeURIComponent(state.resultFilename));
      outputUrl=result.outputUrl;sectionsData=result.sections;resultOriginal=result.original;renderSections();
      Vocabulary.mount({snapshot:result.vocabulary,source:epubBook?.title||'恢复的阅读结果'});
      savePath.textContent='已永久保存：outputs/'+result.filename;downloadBtn.style.display='block';
    }
    analysisJobId=state.jobId||'';
    if(analysisJobId){
      const job=await get('/api/jobs/'+encodeURIComponent(analysisJobId));
      if(job.status==='complete'&&job.filename){
        const result=await get('/api/saved-result/'+encodeURIComponent(job.filename));
        outputUrl=result.outputUrl;sectionsData=result.sections;resultOriginal=result.original;renderSections();
        savePath.textContent='已永久保存：outputs/'+result.filename;downloadBtn.style.display='block';analysisJobId='';
      }else{
        byId('resumeAnalysisBtn').hidden=false;
        byId('resumeAnalysisBtn').disabled=job.status==='running';analyzeBtn.hidden=true;
        byId('resumeAnalysisBtn').textContent=job.status==='running'?'正在保存上一句，请稍候':'继续分析（已保存 '+job.completed+' / '+job.total+' 句）';
      }
    }
    const layout=state.layout||{};
    setInputExpanded(!!layout.inputExpanded);setEpubCollapsed(!!layout.epubCollapsed);setPreviewCollapsed(!!layout.previewCollapsed);
    if(layout.columnWidth){byId('columnWidth').value=layout.columnWidth;dualPanel.style.gridTemplateColumns=layout.columnWidth+'% minmax(0,1fr)';}
    selectedSentence=state.selectedSentence??null;
    if(state.resultFilename&&typeof window.requestAnimationFrame==='function'){
      const position=()=>{
        const label=selectedSentence!==null?document.querySelector('#translationContent [data-section="'+selectedSentence+'"]'):null;
        label?.click();
        leftContent.parentElement.scrollTop=state.scroll?.left||0;panelRight.scrollTop=state.scroll?.right||0;
        const translation=byId('translationPanel');if(translation)translation.scrollTop=state.scroll?.translation||0;
      };
      document.addEventListener('epub-original-ready',position,{once:true});
      window.requestAnimationFrame(position);
    }
    statusText.textContent=analysisJobId?'已恢复上次进度，可点击继续分析':'已恢复上次的书籍和阅读进度';
  }finally{lock(false);}
}
if(window.ReaderSession){
  document.addEventListener('study-sentence-selected',event=>{selectedSentence=event.detail.id;});
  workspaceSession=window.ReaderSession.mount({capture:captureWorkspace,restore:restoreWorkspace,status:byId('sessionStatus')});
  document.addEventListener('change',()=>{void workspaceSession.flush();});
  document.addEventListener('click',()=>{window.setTimeout(()=>{void workspaceSession.flush();},250);});
  let checkingJob=false;
  window.setInterval(async()=>{
    if(!analysisJobId||busy||checkingJob)return;
    checkingJob=true;const jobId=analysisJobId;
    try{
      const response=await fetch('/api/jobs/'+encodeURIComponent(jobId));if(!response.ok)return;
      const job=await response.json();if(analysisJobId!==jobId||busy)return;
      if(job.status==='complete'&&job.filename){
        const resultResponse=await fetch('/api/saved-result/'+encodeURIComponent(job.filename)+'?view=reader');
        if(!resultResponse.ok)return;const result=await resultResponse.json();
        if(analysisJobId!==jobId||busy)return;
        outputUrl=result.outputUrl;sectionsData=result.sections;resultOriginal=result.original;renderSections();
        savePath.textContent='已永久保存：outputs/'+result.filename;downloadBtn.style.display='block';
        analysisJobId='';byId('resumeAnalysisBtn').hidden=true;analyzeBtn.hidden=false;void workspaceSession.flush();
      }else{
        byId('resumeAnalysisBtn').disabled=job.status==='running';
        byId('resumeAnalysisBtn').textContent=job.status==='running'?'正在保存上一句，请稍候':'继续分析（已保存 '+job.completed+' / '+job.total+' 句）';
      }
    }catch{}finally{checkingJob=false;}
  },2000);
}
