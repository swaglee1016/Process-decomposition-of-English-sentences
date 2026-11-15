(function(root){
 'use strict';
 const doc=root.document;if(!doc)return;
 let words=[],config={},source='',selection=null,actionId=null,actionWord=null,chosen=null,lookupSerial=0,connected=false;
 const documents=new Map(),explanations=new Map(),contextExplanations=new Map();let ui;
 function contextNote(entry){return contextExplanations.get(JSON.stringify([entry.word,entry.context.trim()]))||entry.dictionary?.contextNotes?.find(note=>note.context.trim()===entry.context.trim());}
 async function fetchContext(entry,serial){if(!entry.context)return;if(entry.context.length>2000){if(serial===lookupSerial&&chosen===entry.word){currentEntry.contextError='This passage is too long for an automatic contextual explanation (limit: 2,000 characters).';renderDetail(currentEntry);}return;}if(contextNote(entry))return;if(root.location.protocol==='file:'&&!connected){if(serial===lookupSerial&&chosen===entry.word){currentEntry.contextError='No contextual explanation is saved for this sentence. Start the app and sync to look it up.';renderDetail(currentEntry);}return;}try{const {note}=await api('/context',{word:entry.word,context:entry.context});contextExplanations.set(JSON.stringify([entry.word,entry.context.trim()]),note);while(contextExplanations.size>32)contextExplanations.delete(contextExplanations.keys().next().value);if(serial===lookupSerial&&chosen===entry.word&&currentEntry.context===entry.context)renderDetail(currentEntry);}catch{if(serial===lookupSerial&&chosen===entry.word&&currentEntry.context===entry.context){currentEntry.contextError='The contextual explanation is unavailable. The general definitions below are still readable.';renderDetail(currentEntry);}}}
 let currentEntry=null,history=[],dictionaryWindow=null;
 function prepareShortcut(word){
  let input=ui.dialog.querySelector('#vocabularyCopyTarget');
  if(!input){input=element('textarea',null,'vocabularyCopyTarget');input.readOnly=true;input.tabIndex=-1;input.setAttribute('aria-label','欧路快捷搜索复制目标');input.style.cssText='position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';ui.dialog.append(input);}
  input.value=word;input.focus({preventScroll:true});input.select();
 }
 function closeDictionary(){if(dictionaryWindow&&!dictionaryWindow.closed){dictionaryWindow.close();}else ui.dialog.close();stopSpeech();}
 function openDictionary(){
  if(dictionaryWindow&&!dictionaryWindow.closed){dictionaryWindow.focus();return true;}
  let child;try{child=root.open('about:blank','_blank','popup=yes,width=960,height=780,resizable=yes,scrollbars=yes');}catch{}
  if(!child){ui.dialog.showModal();message('浏览器阻止了独立查词窗口，请允许此页面弹窗；目前使用页内查词。');return false;}
  dictionaryWindow=child;const target=child.document;target.title='单词查询';target.documentElement.lang='zh-CN';
  const style=target.createElement('style');let css='';for(const sheet of doc.styleSheets)try{for(const rule of sheet.cssRules)if(rule.cssText.includes('vocabulary'))css+=rule.cssText+'\n';}catch{}
  style.textContent=css+'body{margin:0;background:white}#vocabularyDialog{position:static;margin:0;box-sizing:border-box;width:100%;height:100vh;min-width:0;min-height:0;max-width:none;max-height:none;border:0;border-radius:0;resize:none;box-shadow:none;padding:16px}';target.head.append(style);
  if(ui.dialog.open)ui.dialog.close();target.body.append(ui.dialog);ui.dialog.show();
  child.addEventListener('pagehide',()=>{if(dictionaryWindow!==child)return;stopSpeech();lookupSerial++;ui.dialog.close();doc.body.append(ui.dialog);dictionaryWindow=null;});
  return true;
 }
 root.addEventListener('pagehide',()=>{if(dictionaryWindow&&!dictionaryWindow.closed)dictionaryWindow.close();});
 let speechToken=0,speechTimer=null,voiceHandler=null;
 function stopSpeech(){speechToken++;if(speechTimer)root.clearTimeout(speechTimer);speechTimer=null;if(voiceHandler)root.speechSynthesis?.removeEventListener?.('voiceschanged',voiceHandler);voiceHandler=null;root.speechSynthesis?.cancel();}
 function pronounce(word){stopSpeech();if(!root.speechSynthesis||!root.SpeechSynthesisUtterance)return;const token=speechToken;const attempt=()=>{if(token!==speechToken||!ui.dialog.open||chosen!==word)return true;const voice=root.speechSynthesis.getVoices().find(item=>item.lang.toLowerCase()==='en-us');if(!voice)return false;const utterance=new root.SpeechSynthesisUtterance(word);utterance.lang='en-US';utterance.voice=voice;root.speechSynthesis.speak(utterance);if(speechTimer)root.clearTimeout(speechTimer);if(voiceHandler)root.speechSynthesis.removeEventListener?.('voiceschanged',voiceHandler);voiceHandler=null;speechTimer=null;return true;};if(attempt())return;voiceHandler=attempt;root.speechSynthesis.addEventListener?.('voiceschanged',voiceHandler);speechTimer=root.setTimeout(()=>{if(!attempt()&&token===speechToken){stopSpeech();message('美式语音尚未就绪，可稍后点击词性旁的朗读按钮重试。');}},2000);}
 function captureView(){return {entry:currentEntry,groups:[...ui.detail.querySelectorAll('details')].map(node=>node.dataset.relationGroup),open:[...ui.detail.querySelectorAll('details[open]')].map(node=>node.dataset.relationGroup),scroll:ui.detail.scrollTop};}
 function restoreView(state){for(const node of ui.detail.querySelectorAll('details'))if(state.groups.includes(node.dataset.relationGroup))node.open=state.open.includes(node.dataset.relationGroup);ui.detail.scrollTop=state.scroll;}
 function definitionContext(target){const example=target.closest('small');if(example)return example.textContent.replace(/^例句：/u,'').slice(0,4000);const node=target.closest('li,p');if(!node)return target.textContent;const copy=node.cloneNode(true);for(const child of copy.querySelectorAll('small'))child.remove();return copy.textContent.slice(0,4000);}
 function lookupText(tag,text){const node=element(tag);const value=String(text||'');let start=0;for(const match of value.matchAll(/[A-Za-z]+(?:['’\-][A-Za-z]+)*/g)){node.append(doc.createTextNode(value.slice(start,match.index)));const word=element('span',match[0]);try{word.dataset.lookupWord=root.VocabularyShared.normalizeWord(match[0]);}catch{node.append(doc.createTextNode(match[0]));start=match.index+match[0].length;continue;}word.title='双击查词';node.append(word);start=match.index+match[0].length;}node.append(doc.createTextNode(value.slice(start)));return node;}
 async function navigateLookup(entry,nested=false){if(nested&&entry.word===chosen)return;ui.dialog.ownerDocument.getSelection()?.removeAllRanges();if(root.location.protocol==='http:'||connected){prepareShortcut(entry.word);api('/eudic',{word:entry.word}).catch(error=>notify(error.message));}stopSpeech();if(nested&&currentEntry){history.push(captureView());if(history.length>100)history.shift();}else if(!nested)history=[];chosen=entry.word;const serial=++lookupSerial;renderList();renderDetail(entry);const fill=root.location.protocol==='http:'||connected;try{await fetchExplanation(entry,fill,serial,fill);if(serial===lookupSerial){message('当前词释义已就绪；重复查询优先使用缓存');pronounce(entry.word);}}catch(error){if(serial===lookupSerial){message(error.message);if(currentEntry?.dictionary)pronounce(entry.word);}}if(serial===lookupSerial)fetchContext(currentEntry,serial);}
 function goBack(){const state=history.pop();if(!state)return;stopSpeech();const serial=++lookupSerial;chosen=state.entry.word;const entry={...state.entry,...explanations.get(chosen),...words.find(item=>item.word===chosen),context:state.entry.context,contextKind:state.entry.contextKind,source:state.entry.source,contextError:state.entry.contextError};renderList();renderDetail(entry);restoreView(state);fetchContext(entry,serial);if(entry.dictionary)pronounce(entry.word);else fetchExplanation(entry,false,serial).then(()=>{if(serial===lookupSerial)pronounce(entry.word);}).catch(error=>{if(serial===lookupSerial)message(error.message);});}
 function element(tag,text,id){const node=doc.createElement(tag);if(text!=null)node.textContent=text;if(id)node.id=id;return node;}
 function button(text,id,handler){const node=element('button',text,id);node.type='button';node.addEventListener('click',handler);return node;}
 function message(text){ui.status.textContent=text;}
 function notify(text,undo=false){ui.toast.replaceChildren(element('span',text));if(undo)ui.toast.append(button('撤销','vocabularyUndo',undoAdd));ui.toast.append(button('关闭',null,()=>{ui.toast.hidden=true;}));ui.toast.hidden=false;}
 function init(){
  if(ui)return;
  const open=button('生词库 · 0','vocabularyButton',()=>{renderList();openDictionary();ui.search.focus();});
  const popup=element('div',null,'vocabularySelection');popup.hidden=true;popup.setAttribute('role','group');popup.setAttribute('aria-label','收录选中的英文单词');
  const label=element('span');const add=button('加入生词库','vocabularyAdd',addSelection);const remove=button('移出生词库','vocabularyRemove',()=>removeWord(selection?.word));remove.hidden=true;popup.append(label,add,button('查看释义','vocabularyExplain',explainSelection),remove,button('取消',null,()=>{popup.hidden=true;}));popup.addEventListener('pointerdown',event=>event.preventDefault());
  const toast=element('div',null,'vocabularyToast');toast.hidden=true;toast.setAttribute('role','status');
  const dialog=element('dialog',null,'vocabularyDialog');dialog.setAttribute('aria-labelledby','vocabularyTitle');
  dialog.addEventListener('close',stopSpeech);
  let backdropPress=false;
  dialog.addEventListener('pointerdown',event=>{const bounds=dialog.getBoundingClientRect();backdropPress=event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom;});
  dialog.addEventListener('click',event=>{
   if(event.target!==dialog||!backdropPress)return;
   const bounds=dialog.getBoundingClientRect();
   if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)dialog.close();
  });
  const header=element('header');header.append(element('h2','我的生词库','vocabularyTitle'),button('同步本机词库','vocabularySync',async()=>{try{await refresh();}catch(error){message(error.message);}}),button('关闭','vocabularyClose',closeDictionary));
  const status=element('p','读取本页保存的生词快照','vocabularyStatus');status.setAttribute('role','status');
  const search=element('input',null,'vocabularySearch');search.type='search';search.placeholder='搜索单词';search.setAttribute('aria-label','搜索生词');search.addEventListener('input',renderList);
  const grid=element('div');grid.className='vocabulary-grid';const list=element('div');list.className='vocabulary-list';list.setAttribute('aria-label','生词列表');const detail=element('div','点击单词查看词义与发音','vocabularyDetail');grid.append(list,detail);dialog.append(header,status,search,grid);
  (doc.querySelector('#panelRight .panel-header')||doc.body).append(open);doc.body.append(popup,toast,dialog);ui={open,popup,label,add,remove,toast,dialog,status,search,list,detail};
  detail.addEventListener('dblclick',event=>{const target=event.target.closest('[data-lookup-word]');if(!target)return;event.preventDefault();const word=target.dataset.lookupWord;const entry={...(words.find(item=>item.word===word)||explanations.get(word)),word,context:definitionContext(target),source:('释义查词：'+(chosen||'')).slice(0,300),contextKind:'definition',contextError:null};navigateLookup(entry,true);});
  doc.addEventListener('epub-original-ready',event=>{for(const frame of event.detail.frames)attachDocument(frame.contentDocument,frame);});
  doc.addEventListener('keydown',event=>{if(event.key==='Escape'){popup.hidden=true;}});
 }
 function baseUrl(){
  if(root.location.protocol==='http:')return root.location.origin;
  try{const url=new URL(config.baseUrl);if(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&url.pathname==='/'&&!url.username&&!url.password&&!url.search&&!url.hash)return url.origin;}catch{}
  throw new Error('此页没有本机词库连接，请从程序重新生成阅读页');
 }
 async function api(route,body){
  try{
   const base=baseUrl();
   if(!config.token){if(root.location.protocol!=='http:')throw new Error('请在本机程序重新打开阅读页面');const response=await fetch(base+'/api/vocabulary/session',{headers:{'X-Vocabulary-Client':'reader'},signal:AbortSignal.timeout(8000)});if(!response.ok)throw new Error('无法连接本机词库');Object.assign(config,await response.json());}
   const response=await fetch(base+'/api/vocabulary'+route,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+config.token,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(route.endsWith('/lookup')||route==='/explain'?60000:18000)});
   const data=await response.json();if(!response.ok)throw new Error(data.error||'词库操作失败');return data;
  }catch(error){if(error instanceof TypeError||error.name==='TimeoutError')throw new Error('无法连接本机程序。请启动程序后重试；本页缓存的词义仍可阅读。');throw error;}
 }
 function update(){ui.open.textContent='生词库 · '+words.length;renderList();highlightAll();}
 function receive(entry){if(!entry)return;const index=words.findIndex(item=>item.word===entry.word);if(index<0)words.unshift(entry);else words[index]={...words[index],...entry};update();if(chosen===entry.word)renderDetail(words.find(item=>item.word===chosen));}
 async function refresh(){
  const data=await api('/words');connected=true;const previous=new Map(words.map(entry=>[entry.word,entry]));words=data.words.map(entry=>({...previous.get(entry.word),...entry}));message('已连接本机词库 · '+words.length+' 个单词');update();
  if(chosen){const entry=words.find(item=>item.word===chosen)||explanations.get(chosen)||currentEntry;if(entry)renderDetail(entry);}
 }
 function renderList(){
  if(!ui)return;ui.list.replaceChildren();const query=ui.search.value.trim().toLowerCase();const entries=words.filter(entry=>entry.word.includes(query));
  for(const entry of entries){const item=button(entry.word,null,()=>showWord(entry.word));item.dataset.word=entry.word;if(entry.word===chosen)item.setAttribute('aria-current','true');ui.list.append(item);}
  if(!entries.length)ui.list.append(element('p',words.length?'没有匹配的单词':'双击英文原文中的单词查词，再按需加入生词库。'));
 }
 async function showWord(word){
  stopSpeech();
  history=[];chosen=word;renderList();const entry=words.find(item=>item.word===word);renderDetail(entry);const serial=++lookupSerial;
  // A file opens completely offline. Only explicit sync/add/retry contacts the app.
  if(root.location.protocol==='http:'||connected)try{const data=await api('/words/'+encodeURIComponent(word));if(serial===lookupSerial&&chosen===word)receive(data.entry);}catch(error){message(error.message);}
  if(serial===lookupSerial&&chosen===word){const fill=root.location.protocol==='http:'||connected;try{await fetchExplanation(currentEntry,fill,serial,fill);}catch(error){if(serial===lookupSerial)message(error.message);}if(serial===lookupSerial){pronounce(word);fetchContext(currentEntry,serial);}}
 }
 function renderDetail(entry){
  if(currentEntry?.word===entry?.word&&entry===words.find(item=>item.word===entry.word))entry={...entry,context:currentEntry.context,contextKind:currentEntry.contextKind,contextError:currentEntry.contextError};
  const state=currentEntry?.word===entry?.word?captureView():null;currentEntry=entry;const panel=ui.detail;panel.replaceChildren();if(!entry)return;
  if(history.length)panel.append(button('返回上一词','vocabularyBack',goBack));
  panel.append(element('h3',entry.word));
  if(words.some(item=>item.word===entry.word)){panel.append(button('移出生词库',null,()=>removeWord(entry.word)));if(actionId&&actionWord===entry.word)panel.append(button('撤销本次收录','vocabularyDetailUndo',undoAdd));}
  else panel.append(button('加入生词库','vocabularyDetailAdd',event=>addSelection(event,entry)));
  if(entry.context){const box=element('section',null,'vocabularyContext');const note=contextNote(entry);box.append(element('h4',entry.contextKind==='definition'?'Meaning and role in this definition / example':'Meaning and role in the original sentence'));if(note){box.append(lookupText('p',note.meaning),lookupText('p',note.partOfSpeech+' · '+note.role));}else{box.append(element('p',entry.contextError||'Interpreting this word in its sentence…'));if(entry.contextError&&entry.context.length<=2000)box.append(button('重试原句解释',null,()=>fetchContext(entry,lookupSerial)));}panel.append(box);}
  const dictionary=entry.dictionary;
  if(dictionary){
   for(const meaning of dictionary.meanings||[]){const heading=lookupText('h4',meaning.partOfSpeech||'释义');const phonetic=meaning.americanPhonetic;heading.append(element('span',phonetic?' · 美式音标：'+phonetic:' · 美式读音待补齐'),button('美式朗读',null,()=>pronounce(entry.word)));panel.append(heading);const list=element('ol');for(const definition of meaning.definitions||[]){const item=lookupText('li',definition.definition);if(definition.example)item.append(lookupText('small','例句：'+definition.example));list.append(item);}panel.append(list);}
   for(const [group,label] of [['synonyms','近义词'],['antonyms','反义词'],['relatedWords','同词根／词缀相近词']]){const fold=element('details');fold.open=true;fold.dataset.relationGroup=group;fold.append(element('summary',label));const entries=dictionary.relations?.[group]||(group==='synonyms'?[...new Set((dictionary.meanings||[]).flatMap(m=>(m.definitions||[]).flatMap(d=>d.synonyms||[])))].map(word=>({word})):[]);for(const related of entries)fold.append(lookupText('p',[related.word,related.relationship,related.explanation].filter(Boolean).join(' · ')));if(!entries.length)fold.append(element('p',dictionary.relationsVersion===1?'暂无可靠条目':'相关词待补齐。'));panel.append(fold);}
   const credits=element('small');credits.textContent=(dictionary.sources||[]).map(item=>[item.license?.name,...(item.urls||[])].filter(Boolean).join(' · ')).join('\n');if(credits.textContent)panel.append(credits);
  }else panel.append(element('p','DeepSeek 释义尚未生成。仅查询当前单词，不会批量查词。'));
  if(entry.lookupError){const error=element('p',entry.lookupError);error.className='vocabulary-error';panel.append(error);}
  if(!dictionary||dictionary.provider!=='deepseek')panel.append(button('生成 DeepSeek 释义',null,async event=>{const control=event.currentTarget;control.disabled=true;try{await fetchExplanation(entry);message('释义已生成');}catch(error){message(error.message);}finally{control.disabled=false;}}));
  if(entry.context){panel.append(element('h4','遇到它的原句'),element('blockquote',entry.context));}if(entry.source)panel.append(element('small','来源：'+entry.source));
  if(state)restoreView(state);else panel.scrollTop=0;
 }
 async function fetchExplanation(entry,includeRelations=false,serial=lookupSerial,includePronunciations=false){
  const cached=words.find(item=>item.word===entry.word)?.dictionary||explanations.get(entry.word)?.dictionary;
  if(cached?.provider==='deepseek'&&(!includeRelations||cached.relationsVersion===1)&&(!includePronunciations||cached.pronunciationVersion===1)){if(serial===lookupSerial&&chosen===entry.word)renderDetail({...entry,dictionary:cached});return;}
  const data=await api('/explain',{word:entry.word,...(includeRelations?{includeRelations:true}:{}),...(includePronunciations?{includePronunciations:true}:{})});const explained={...entry,...data.entry};explanations.set(entry.word,explained);while(explanations.size>32)explanations.delete(explanations.keys().next().value);
  const index=words.findIndex(item=>item.word===entry.word);if(index>=0){words[index]={...words[index],...explained};update();}if(serial===lookupSerial&&chosen===entry.word)renderDetail(explained);
 }
 async function explainSelection(){if(!selection)return;const entry={...(words.find(item=>item.word===selection.word)||explanations.get(selection.word)),...selection,contextKind:'source',contextError:null};ui.popup.hidden=true;openDictionary();message('只查询当前单词，已有释义优先读缓存');await navigateLookup(entry);}
 async function removeWord(word){if(!word)return;ui.remove.disabled=true;try{await api('/words/'+encodeURIComponent(word)+'/remove',{});words=words.filter(item=>item.word!==word);actionId=null;actionWord=null;update();ui.popup.hidden=true;for(const document of documents.keys())document.getSelection()?.removeAllRanges();if(chosen===word)renderDetail(currentEntry);notify('已移出生词库：'+word);}catch(error){notify(error.message);}finally{ui.remove.disabled=false;}}
 async function addSelection(event,entry=selection){
  if(!entry)return;const item={word:entry.word,context:entry.context||'',source:entry.source||''};const control=event?.currentTarget||ui.add;control.disabled=true;ui.add.disabled=true;
  try{
   const data=await api('/words',item);actionId=data.actionId;actionWord=data.created?item.word:null;const cached=entry.dictionary||explanations.get(item.word)?.dictionary;receive({...data.entry,dictionary:data.entry.dictionary||cached||null});ui.popup.hidden=true;for(const document of documents.keys())document.getSelection()?.removeAllRanges();
   notify(data.created?'已收录 '+item.word:'这个单词已在生词库',data.created);
   if(data.created||data.entry.dictionary?.provider!=='deepseek')api('/words/'+encodeURIComponent(item.word)+'/lookup',{}).then(lookup=>{if(lookup.entry&&words.some(entry=>entry.word===item.word))receive(lookup.entry);}).catch(error=>message(error.message));
  }catch(error){notify(error.message,!!actionId);}finally{control.disabled=false;ui.add.disabled=false;}
 }
 async function undoAdd(){const id=actionId;if(!id)return;const button=doc.getElementById('vocabularyUndo');if(button)button.disabled=true;try{const data=await api('/undo',{actionId:id});if(data.undone){words=words.filter(entry=>entry.word!==data.word);update();if(chosen===data.word)renderDetail(currentEntry);notify('已撤销收录 '+data.word);}else notify('这次收录已撤销或单词后来重新收录');if(actionId===id){actionId=null;actionWord=null;}}catch(error){notify(error.message,true);}}
 function selectedWord(document,frame){
  selection=null;ui.popup.hidden=true;
  const current=document.getSelection();if(!current||current.rangeCount!==1||current.isCollapsed){ui.popup.hidden=true;return;}
  const range=current.getRangeAt(0);const node=range.commonAncestorContainer.nodeType===1?range.commonAncestorContainer:range.commonAncestorContainer.parentElement;
  const scope=frame?node.closest('p,li,h1,h2,h3,h4,h5,h6,blockquote,div')||document.body:node.closest('#leftContent .para-text');
  if(!scope||node.closest('button,input,textarea,script,style')||!scope.contains(range.startContainer)||!scope.contains(range.endContainer)){ui.popup.hidden=true;return;}
  let word;try{word=root.VocabularyShared.normalizeWord(current.toString());}catch{ui.popup.hidden=true;return;}
  const prefix=document.createRange();prefix.selectNodeContents(scope);prefix.setEnd(range.startContainer,range.startOffset);const suffix=document.createRange();suffix.selectNodeContents(scope);suffix.setStart(range.endContainer,range.endOffset);
  const selectedText=current.toString();
  if((/[a-zA-Z'’\-]$/.test(prefix.toString())&&!/^\s/u.test(selectedText))||(/^[a-zA-Z'’\-]/.test(suffix.toString())&&!/\s$/u.test(selectedText))){ui.popup.hidden=true;return;}
  const sentence=node.closest('[data-section]');let context=sentence?.textContent||scope.textContent;if(frame&&sentence)context=doc.querySelector('.sent-card[data-section="'+sentence.dataset.section+'"] .sentence-caption')?.textContent||context;
  word=root.VocabularyShared.findVocabularyWord(word,words)||word;
  selection={word,context:context.slice(0,4000),source:source.slice(0,300)};return selection;
 }
 function highlight(document,frame){
  const roots=frame?[document.body]:[...document.querySelectorAll('#leftContent .para-text')];const known=root.VocabularyShared.buildWordIndex(words);
  for(const rootNode of roots){
   for(const span of rootNode.querySelectorAll('.vocabulary-word')){const parent=span.parentNode;span.replaceWith(...span.childNodes);parent.normalize();}
   if(!known.size)continue;
   // Match across inline book markup before wrapping individual text nodes.
   // Block elements and explicit line breaks separate words.
   const groups=[],walker=document.createTreeWalker(rootNode,5);let node,lastBlock=null;
   while(node=walker.nextNode()){
    if(node.nodeType!==3&&node.tagName!=='BR')continue;
    const parent=node.nodeType===3?node.parentElement:node;
    if(parent.closest('script,style,textarea,button,audio'))continue;
    const block=parent.closest('p,li,h1,h2,h3,h4,h5,h6,blockquote,td,th,pre,div,body')||rootNode;
    if(block!==lastBlock){groups.push([]);lastBlock=block;}
    groups[groups.length-1].push({node:node.nodeType===3?node:null,text:node.nodeType===3?node.textContent:'\n'});
   }
   for(const nodes of groups){
    const ranges=[];let offset=0;
    for(const run of root.VocabularyShared.wordRuns(nodes.map(item=>item.text).join(''),known)){if(run.word)ranges.push({start:offset,end:offset+run.text.length,word:run.word});offset+=run.text.length;}
    offset=0;let first=0;
    for(const item of nodes){
     const start=offset,end=offset+item.text.length;offset=end;if(!item.node)continue;
     while(first<ranges.length&&ranges[first].end<=start)first++;
     if(first===ranges.length||ranges[first].start>=end)continue;
     const fragment=document.createDocumentFragment();let cursor=0;
     for(let i=first;i<ranges.length&&ranges[i].start<end;i++){
      const run=ranges[i],left=Math.max(start,run.start)-start,right=Math.min(end,run.end)-start;
      if(left>cursor)fragment.append(document.createTextNode(item.text.slice(cursor,left)));
      const span=document.createElement('span');span.className='vocabulary-word';span.dataset.word=run.word;span.title='已收录生词：'+run.word;span.textContent=item.text.slice(left,right);fragment.append(span);cursor=right;
     }
     if(cursor<item.text.length)fragment.append(document.createTextNode(item.text.slice(cursor)));item.node.replaceWith(fragment);
    }
   }
  }
 }
 function highlightAll(){for(const [document,frame] of documents){if(frame&&!frame.isConnected){documents.delete(document);continue;}highlight(document,frame);}}
 function attachDocument(document,frame=null){
  if(!document||documents.has(document)){if(document)highlight(document,frame);return;}
  documents.set(document,frame);if(frame){const style=document.createElement('style');style.textContent='.vocabulary-word{background:#fff0b5!important;text-decoration:underline dotted #b47708;text-underline-offset:3px;border-radius:2px}';document.head.append(style);}
  document.addEventListener('dblclick',()=>{if(selectedWord(document,frame))explainSelection();});
  highlight(document,frame);
 }
 function mount(options={}){
  init();if(options.snapshot){config={...options.snapshot};words=Array.isArray(config.words)?config.words:[];message('本页生词快照 · '+words.length+' 个单词');}source=options.source||doc.title||'';attachDocument(doc);update();
  if(root.location.protocol==='http:')refresh().catch(error=>message(error.message));
 }
 root.Vocabulary={mount,attachDocument};
})(typeof window!=='undefined'?window:globalThis);
