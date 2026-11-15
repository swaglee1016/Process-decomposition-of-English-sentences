const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');

const BOOK_ID=/^[a-f0-9]{64}$/;
const READING_ID=/^(?:draft|[a-f0-9]{64})$/;
const JOB_ID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const RESULT_NAME=/^sentence-decomposition-\d{8}-\d{6}(?:-\d+)?\.html$/;
function invalid(message='保存的阅读状态格式无效') {return Object.assign(new Error(message),{status:400});}
function requireId(value,pattern){if(typeof value!=='string'||!pattern.test(value))throw invalid('阅读记录标识无效');return value;}
function plain(value){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;}
function validateState(state){
 if(!plain(state)||state.schema!==1)throw invalid();
 const allowed=new Set(['schema','input','bookId','selection','preview','resultFilename','selectedSentence','scroll','layout','jobId','readingLabel']);
 for(const key of Object.keys(state))if(!allowed.has(key))throw invalid();
 const json=JSON.stringify(state);if(Buffer.byteLength(json)>10*1024*1024)throw invalid('阅读状态超过 10 MB，尚未保存');
 function safe(value){if(!value||typeof value!=='object')return;for(const [key,item] of Object.entries(value)){if(['__proto__','constructor','prototype'].includes(key))throw invalid();safe(item);}}
 safe(state);
 for(const [key,pattern] of [['bookId',BOOK_ID],['jobId',JOB_ID],['resultFilename',RESULT_NAME]])if(state[key]!=null)requireId(state[key],pattern);
 if(state.input!=null&&(!plain(state.input)||typeof state.input.text!=='string'||!['preserve','pdf'].includes(state.input.paragraphMode)))throw invalid();
 if(state.selection!=null){
  const selection=state.selection;
  const ids=value=>value==null||(Array.isArray(value)&&value.length<=4000&&value.every(id=>typeof id==='string'&&id.length<=100));
  if(!plain(selection)||!ids(selection.ids)||!ids(selection.loadedIds)||!['chapter','reading','candidate'].includes(selection.mode)||(selection.activeId!=null&&typeof selection.activeId!=='string'))throw invalid();
 }
 if(state.selectedSentence!=null&&!/^\d{1,8}$/.test(String(state.selectedSentence)))throw invalid();
 if(state.readingLabel!=null){
  const label=state.readingLabel;
  if(!plain(label)||Object.keys(label).some(key=>!['title','chapter'].includes(key))
   ||typeof label.title!=='string'||label.title.length>256
   ||typeof label.chapter!=='string'||label.chapter.length>256)throw invalid();
 }
 if(state.preview!=null){
  const preview=state.preview;
  if(!plain(preview)||typeof preview.text!=='string'||(preview.sections!=null&&(!Array.isArray(preview.sections)||preview.sections.length>100000)))throw invalid();
  for(const section of preview.sections||[]){if(!plain(section)||typeof section.paragraph!=='string'||!Array.isArray(section.sentences))throw invalid();for(const sentence of section.sentences)if(!plain(sentence)||typeof sentence.text!=='string'||!Number.isInteger(sentence.start)||!Number.isInteger(sentence.end)||sentence.start<0||sentence.end<sentence.start||sentence.end>section.paragraph.length)throw invalid();}
 }
 for(const key of ['scroll','layout'])if(state[key]!=null&&!plain(state[key]))throw invalid();
 if(state.scroll)for(const [key,value] of Object.entries(state.scroll))if(!['left','translation','right'].includes(key)||!Number.isFinite(value)||value<0)throw invalid();
 if(state.layout)for(const [key,value] of Object.entries(state.layout)){
  if(['inputExpanded','epubCollapsed','previewCollapsed'].includes(key)){if(typeof value!=='boolean')throw invalid();}
  else if(key==='columnWidth'){if(!Number.isFinite(Number(value))||Number(value)<0||Number(value)>100)throw invalid();}
  else throw invalid();
 }
 return JSON.parse(json);
}

async function atomicWrite(filename,data){
 await fs.mkdir(path.dirname(filename),{recursive:true});
 const temporary=filename+'.'+crypto.randomUUID()+'.tmp';
 const handle=await fs.open(temporary,'wx');
 try{await handle.writeFile(data);await handle.sync();}finally{await handle.close();}
 await fs.rename(temporary,filename);
}
async function readJson(filename,fallback){
 try{return JSON.parse(await fs.readFile(filename,'utf8'));}catch(error){if(error.code==='ENOENT'&&fallback!==undefined)return fallback;throw error;}
}

function readingIdentity(state){
 if(BOOK_ID.test(state?.bookId||''))return state.bookId;
 if(state?.input?.text?.trim()||state?.preview?.text?.trim()||state?.resultFilename||state?.jobId)return 'draft';
 return null;
}
function hasReadingProgress(state){
 if(!state)return false;
 const selection=state.selection;
 return Boolean(state.input?.text?.trim()||state.preview?.text?.trim()||state.resultFilename
  ||state.jobId||state.selectedSentence!=null||selection?.activeId!=null
  ||selection?.ids?.length||selection?.loadedIds?.length);
}

class ReaderSessionStore{
 constructor(directory){
  this.directory=path.resolve(directory);
  this.workspaceWrites=Promise.resolve();
  this.bookTitles=new Map();
 }
 bookFilename(id){return path.join(this.directory,'books',requireId(id,BOOK_ID)+'.epub');}
 async saveBook(buffer){
  const id=crypto.createHash('sha256').update(buffer).digest('hex');
  const filename=this.bookFilename(id);
  try{const existing=await this.readBook(id);if(!existing.equals(buffer))throw Error('保存的原书校验失败');}
  catch(error){if(error.code!=='ENOENT')throw error;await atomicWrite(filename,buffer);}
  return id;
 }
 async readBook(id){
  const bytes=await fs.readFile(this.bookFilename(id));
  if(crypto.createHash('sha256').update(bytes).digest('hex')!==id)throw Error('保存的原书校验失败');return bytes;
 }
 readWorkspace(){return readJson(path.join(this.directory,'workspace.json'),{state:null,revision:0});}
 readingFilename(id){return path.join(this.directory,'reading-history',requireId(id,READING_ID)+'.json');}
 async readArchivedReading(id){
  const record=await readJson(this.readingFilename(id),null);
  if(record&&readingIdentity(record.state)!==id)throw Error('阅读记录与原书不符');
  return record;
 }
 async readRecentReading(id){
  requireId(id,READING_ID);
  if(id!=='draft'){
   const source=await fs.lstat(this.bookFilename(id));
   if(!source.isFile())throw Object.assign(new Error('找不到已保存的原书'),{status:404});
  }
  const {state:current}=await this.readWorkspace();
  const state=readingIdentity(current)===id?current:(await this.readArchivedReading(id))?.state;
  if(state)return {state,hasProgress:hasReadingProgress(state)};
  if(id==='draft')throw Object.assign(new Error('找不到最近粘贴的文章'),{status:404});
  return {state:{schema:1,bookId:id},hasProgress:false};
 }
 readBookTitle(id){
  // A legacy import may have only the EPUB and no reading label. Read that
  // book once per process and keep its short title, never the parsed book.
  if(!this.bookTitles.has(id)){
   const title=this.readBook(id).then(bytes=>require('./epubParser').parseEpub(bytes).title).catch(()=>null);
   this.bookTitles.set(id,title);
  }
  return this.bookTitles.get(id);
 }
 async listRecentReading(cachedBookTitle=()=>null){
  const {state:current}=await this.readWorkspace();
  const currentId=readingIdentity(current);
  let sources;
  try{sources=await fs.readdir(path.join(this.directory,'books'),{withFileTypes:true});}
  catch(error){if(error.code!=='ENOENT')throw error;sources=[];}
  const bookIds=sources.filter(file=>file.isFile()&&file.name.endsWith('.epub'))
   .map(file=>file.name.slice(0,-5)).filter(id=>BOOK_ID.test(id));
  const items=[];
  for(const id of ['draft',...bookIds]){
   const isCurrent=id===currentId;
   const record=isCurrent?{state:current}:await this.readArchivedReading(id);
   const state=record?.state;
   const isDraft=id==='draft';
   if(isDraft&&!state)continue;
   const title=isDraft?'最近粘贴的文章':state?.readingLabel?.title?.trim()
    ||cachedBookTitle(id)||await this.readBookTitle(id);
   if(!title)continue;
   items.push({updatedAt:record?.updatedAt||0,item:{
    id,type:isDraft?'draft':'book',title:title.slice(0,256),chapter:state?.readingLabel?.chapter||'',
    sentence:state?.selectedSentence==null?null:Number(state.selectedSentence)+1,
    hasProgress:hasReadingProgress(state),current:isCurrent
   }});
  }
  items.sort((a,b)=>Number(b.item.current)-Number(a.item.current)||b.updatedAt-a.updatedAt);
  return items.map(({item})=>item);
 }
 saveWorkspace(state,revision){
  const value=validateState(state);if(!Number.isSafeInteger(revision)||revision<0)throw invalid();
  const save=this.workspaceWrites.then(async()=>{
   const current=await this.readWorkspace();
   if(current.revision!==revision)throw Object.assign(new Error('阅读状态已被另一页面更新，请重新载入该状态'),{status:409,revision:current.revision});
   const previousId=readingIdentity(current.state);
   if(previousId&&previousId!==readingIdentity(value)){
    const record={state:current.state,updatedAt:Date.now()};
    await atomicWrite(this.readingFilename(previousId),JSON.stringify(record));
   }
   const next={state:value,revision:revision+1};await atomicWrite(path.join(this.directory,'workspace.json'),JSON.stringify(next));return next;
  });this.workspaceWrites=save.catch(()=>{});return save;
 }
 jobDirectory(id){return path.join(this.directory,'jobs',requireId(id,JOB_ID));}
 async createJob(request){
  const jobId=crypto.randomUUID();const job={jobId,status:'interrupted',completed:0,total:request.sections.reduce((sum,s)=>sum+s.sentences.length,0)};
  const directory=this.jobDirectory(jobId);await atomicWrite(path.join(directory,'request.json'),JSON.stringify(request));await this.saveJob(job);return job;
 }
 async saveJob(job){await atomicWrite(path.join(this.jobDirectory(job.jobId),'status.json'),JSON.stringify(job));}
 async readJob(id){return readJson(path.join(this.jobDirectory(id),'status.json'));}
 async readJobRequest(id){return readJson(path.join(this.jobDirectory(id),'request.json'));}
 async readSentence(id,index){return readJson(path.join(this.jobDirectory(id),'sentences',index+'.json'),null);}
 async saveSentence(id,index,value){if(!Number.isSafeInteger(index)||index<0)throw invalid();await atomicWrite(path.join(this.jobDirectory(id),'sentences',index+'.json'),JSON.stringify(value));}
}
module.exports={ReaderSessionStore,BOOK_ID,JOB_ID,RESULT_NAME,requireId,validateState,atomicWrite};
