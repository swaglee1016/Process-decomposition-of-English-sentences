(function(root){
 'use strict';let current=null;
 function addRecap(tools, filename, recap, connection){
  const document = root.document;
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'passageRecapButton';
  button.textContent = 'Reading recap';
  button.setAttribute('aria-haspopup', 'dialog');
  tools.append(button);
  const dialog = document.createElement('dialog');
  dialog.className = 'passage-recap';
  dialog.lang = 'en';
  dialog.setAttribute('aria-labelledby', 'passageRecapTitle');
  const title = document.createElement('h2');
  title.id = 'passageRecapTitle';
  title.textContent = 'Reading recap';
  const content = document.createElement('div');
  content.setAttribute('aria-live', 'polite');
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Close';
  close.onclick = () => dialog.close();
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Try again';
  retry.hidden = true;
  dialog.append(title, content, retry, close);
  document.body.append(dialog);
  let loading = false;
  function displayRecap(){
   const lines = recap.split(/\r?\n/).filter(line => line.trim());
   const compact = /^(Main idea|What happens) — /.test(lines[0]);
   retry.hidden = compact;
   if (!compact) {
    content.textContent = recap;
    retry.textContent = 'Shorten recap';
    return;
   }
   const lead = document.createElement('strong');
   lead.textContent = lines[0];
   content.replaceChildren(lead);
   if (lines.length === 1) return;
   const list = document.createElement('ul');
   for (const line of lines.slice(1)) {
    const item = document.createElement('li');
    const text = line.replace(/^- /, '');
    const split = text.indexOf(' — ');
    const label = document.createElement('strong');
    label.textContent = text.slice(0,split);
    item.append(label, text.slice(split));
    list.append(item);
   }
   content.append(list);
  }
  async function show(shorten = false){
   if (!dialog.open) dialog.showModal();
   if (loading) return;
   if (recap && !shorten) {displayRecap(); return;}
   loading = true;
   retry.hidden = true;
   content.textContent = 'Reading this passage…';
   try {
    const headers = {'Content-Type':'application/json'};
    let endpoint = '/api/passage-recap';
    if (root.location.protocol === 'file:') {
     if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(connection?.baseUrl) || !connection.token) throw Error('Open this study page in the local reader to generate its recap.');
     headers.Authorization = 'Bearer ' + connection.token;
     endpoint = connection.baseUrl + endpoint;
    }
    const response = await root.fetch(endpoint, {method:'POST',headers,body:JSON.stringify({filename})});
    if (!response.ok) {
     const error = await response.json().catch(() => ({}));
     throw Error(error.error || 'Open this study page in the local reader and try again.');
    }
    const result = await response.json();
    if (!result.recap) throw Error('The reader returned an empty recap.');
    recap = result.recap;
    displayRecap();
   } catch (error) {
    content.textContent = error instanceof TypeError ? 'Start the local reader, then try again.' : error.message;
    retry.textContent = 'Try again';
    retry.hidden = false;
   } finally {loading = false;}
  }
  button.onclick = () => show();
  retry.onclick = () => show(true);
  return dialog;
 }
 function mount({sections,original,epub,left,right,filename,recap,connection}){
  current?.destroy();if(!sections?.some(section=>section.sentences?.length))return;
  const document=root.document,panel=left.parentElement,items=sections.flatMap(section=>section.sentences||[]);let child=null,timer=null,selected='0',destroyed=false;
  panel.classList.add('reading-workspace');
  const translations=document.createElement('section');translations.className='translation-panel';translations.id='translationPanel';
  const title=document.createElement('h2');title.className='panel-header';title.textContent='对应中文译文';const content=document.createElement('div');content.id='translationContent';content.className='translation-content';translations.append(title,content);panel.insertBefore(translations,right);
  let sentenceIndex=0;
  sections.forEach(section=>{if(!section.sentences?.length)return;const item=document.createElement('p');item.className='translation-item';
   for(const sentence of section.sentences){const index=sentenceIndex++;const text=document.createElement('span');text.className='translation-text';text.dataset.section=String(index);text.tabIndex=0;text.setAttribute('role','button');text.title='第 '+(index+1)+' 句';text.textContent=sentence.translation||'此句译文尚未生成';item.append(text);}
   content.append(item);
  });
  const tools=document.createElement('div');tools.className='workspace-tools';const button=document.createElement('button');button.id='dualScreenButton';button.type='button';button.textContent='双屏阅读';button.title='Ctrl+Alt+D';const status=document.createElement('span');status.setAttribute('role','status');status.textContent=original?'EPUB 原版 · 点击句子联动译文和结构图':'原文 · 点击句子联动译文和结构图';tools.append(button,status);left.prepend(tools);
  const toggle=document.getElementById('readingModeToggle');toggle.hidden=!!original;
  const focus=document.createElement('button');focus.id='readingFocusButton';focus.type='button';focus.textContent='折叠工具栏';tools.append(focus);
  const recapDialog = filename ? addRecap(tools, filename, recap, connection) : null;
  focus.addEventListener('click',()=>{const enabled=document.body.classList.toggle('reading-focus');focus.textContent=enabled?'恢复工具栏':'折叠工具栏';focus.setAttribute('aria-pressed',String(enabled));root.dispatchEvent(new Event('resize'));});
  const widths={source:36,translation:18};const grips=[];
  function applyWidths(){const split=panel.classList.contains('separate-diagram');panel.style.setProperty('--source-width',(split?widths.source/(widths.source+widths.translation)*100:widths.source)+'%');panel.style.setProperty('--translation-width',widths.translation+'%');grips.forEach((grip,index)=>{grip.style.left=(index?widths.source+widths.translation:split?widths.source/(widths.source+widths.translation)*100:widths.source)+'%';grip.hidden=split&&index===1;grip.setAttribute('aria-valuenow',String(Math.round(index?widths.source+widths.translation:widths.source)));});root.dispatchEvent(new Event('resize'));}
  [0,1].forEach(index=>{const grip=document.createElement('div');grip.className='column-resizer';grip.tabIndex=0;grip.setAttribute('role','separator');grip.setAttribute('aria-orientation','vertical');grip.setAttribute('aria-label',index?'调整译文与结构图栏宽':'调整原文与译文栏宽');grip.setAttribute('aria-valuemin','12');grip.setAttribute('aria-valuemax','85');panel.append(grip);grips.push(grip);
   let dragging=false;
   function change(percent){if(index){widths.translation=Math.max(12,Math.min(85-widths.source,percent-widths.source));}else if(panel.classList.contains('separate-diagram')){const total=widths.source+widths.translation;const value=Math.max(25,Math.min(80,percent))/100;widths.source=total*value;widths.translation=total-widths.source;}else{const total=widths.source+widths.translation;widths.source=Math.max(18,Math.min(total-12,percent));widths.translation=total-widths.source;}applyWidths();}
   grip.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();dragging=true;grip.setPointerCapture(event.pointerId);document.body.classList.add('resizing-columns');});grip.addEventListener('pointermove',event=>{if(!dragging)return;const r=panel.getBoundingClientRect();change((event.clientX-r.left)/r.width*100);});const finish=()=>{dragging=false;document.body.classList.remove('resizing-columns');};grip.addEventListener('pointerup',finish);grip.addEventListener('pointercancel',finish);
   grip.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();change((index?widths.source+widths.translation:widths.source)+(event.key==='ArrowRight'?2:-2));});
  });applyWidths();
  function viewport(column){const bounds=column.getBoundingClientRect();let top=Math.max(0,bounds.top);const bottom=Math.min(root.innerHeight,bounds.bottom);for(const header of column.querySelectorAll('.workspace-tools,.reading-header,.reading-mode-bar,.panel-header')){const r=header.getBoundingClientRect();if(r.height&&r.top<bottom&&r.bottom>top)top=Math.max(top,r.bottom);}return {top,bottom,height:Math.max(1,bottom-top)};}
  function sourceRects(id){if(original){for(const frame of left.querySelectorAll('.epub-original-frame')){const label=frame.contentDocument?.querySelector('[data-section="'+id+'"]');if(label){const offset=frame.getBoundingClientRect().top;return [...label.getClientRects()].map(rect=>({top:offset+rect.top,bottom:offset+rect.bottom,height:rect.height}));}}return [];}const label=left.querySelector('.sent-span[data-section="'+id+'"]');return label?[...label.getClientRects()]:[];}
  function sourceRatio(id){const view=viewport(left),rect=sourceRects(id).find(rect=>rect.height&&rect.bottom>view.top&&rect.top<view.bottom);return rect?Math.max(0,Math.min(1,(rect.top-view.top)/view.height)):null;}
  function navigate(id,ratio){const index=Number(id);if(Number.isInteger(index)&&index>=0&&index<items.length){const position=ratio??sourceRatio(selected)??.15;locateOriginal(String(index),position);epub.navigate(String(index));}}
  function locateOriginal(id,ratio){const rect=sourceRects(id).find(rect=>rect.height);if(!rect)return;const view=viewport(left);left.scrollTo({top:Math.max(0,left.scrollTop+rect.top-view.top-ratio*view.height),behavior:'instant'});}
  function selectTranslation(event){const label=event.target.closest('.translation-text');if(!label)return;if(event.type==='keydown'&&!['Enter',' '].includes(event.key))return;event.preventDefault();const view=viewport(translations);navigate(label.dataset.section,Math.max(0,Math.min(1,(label.getBoundingClientRect().top-view.top)/view.height)));}
  content.addEventListener('click',selectTranslation);content.addEventListener('keydown',selectTranslation);
  function highlight(event){const id=event.detail.id;if(id==null)return;selected=String(id);for(const label of content.querySelectorAll('.translation-text')){const active=label.dataset.section===selected;label.classList.toggle('highlight',active);if(active){label.setAttribute('aria-current','true');const view=viewport(translations),ratio=sourceRatio(selected)??.15;const target=view.top+Math.min(ratio*view.height,Math.max(0,view.height-24));translations.scrollTo({top:Math.max(0,translations.scrollTop+label.getBoundingClientRect().top-target),behavior:'instant'});}else label.removeAttribute('aria-current');}renderChild();}
  document.addEventListener('study-sentence-selected',highlight);
  function restore(){if(timer){root.clearInterval(timer);timer=null;}child=null;panel.classList.remove('separate-diagram');applyWidths();button.textContent='双屏阅读';status.textContent=original?'EPUB 原版 · 点击句子联动译文和结构图':'原文 · 点击句子联动译文和结构图';const vocabulary=document.getElementById('vocabularyButton');if(vocabulary)right.querySelector('.panel-header')?.append(vocabulary);root.dispatchEvent(new Event('resize'));}
  function renderChild(){
   if(!child||child.closed)return;const d=child.document,index=Number(selected),card=right.querySelector('.sent-card[data-section="'+selected+'"]');d.getElementById('largeSentence').textContent=items[index]?.text||'';d.getElementById('sentenceCount').textContent=(index+1)+' / '+items.length;d.getElementById('previousSentence').disabled=index<=0;d.getElementById('nextSentence').disabled=index>=items.length-1;
   const image=d.getElementById('largeDiagram'),src=card?.querySelector('img.canvas-image')?.getAttribute('src');
   if(/^data:image\/(?:svg\+xml|png);base64,[A-Za-z0-9+/]+=*$/.test(src||'')){image.hidden=false;if(image.getAttribute('src')!==src)image.src=src;d.getElementById('diagramError').textContent='';}
   else{image.hidden=true;image.removeAttribute('src');d.getElementById('diagramError').textContent=card?.textContent||'此句没有可用结构图';}
  }
  function openDiagram(){
   if(child&&!child.closed){child.focus();return;}
   child=root.open('about:blank','sentence-diagram-'+Date.now(),'popup,width=1100,height=850');
   if(!child){status.textContent='浏览器阻止了弹窗，请允许本页弹窗后再点“双屏阅读”';return;}
   try{
    const d=child.document;d.open();d.write('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\'; img-src data:; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'"><title>结构图 · 双屏阅读</title><style>*{box-sizing:border-box}html,body{margin:0;height:100%;font:15px system-ui;background:#f3f6fa;color:#25364a}body{display:flex;flex-direction:column}header{background:white;padding:12px 18px;border-bottom:1px solid #dbe3ea}nav{display:flex;flex-wrap:wrap;gap:8px;align-items:center}button{border:1px solid #bccddd;background:white;border-radius:5px;padding:7px 12px;cursor:pointer}button:disabled{opacity:.45}#largeSentence{margin:10px 0 0;max-height:20vh;overflow:auto;font:17px/1.65 Georgia,serif}#largeViewport{flex:1;min-height:0;overflow:auto;padding:16px;cursor:grab;touch-action:none}#largeDiagram{display:block;max-width:none;margin:auto;background:white}#diagramError{white-space:pre-wrap;color:#b84232}small{margin-left:auto;color:#6b7e92}</style></head><body><header><nav><button id="previousSentence">上一句</button><span id="sentenceCount"></span><button id="nextSentence">下一句</button><button id="fitDiagram">适配整图</button><button id="actualDiagram">100%</button><button id="zoomOut">−</button><output id="largeZoom"></output><button id="zoomIn">＋</button><small>把此窗口拖到另一块屏幕 · 滚轮缩放、拖动平移</small></nav><p id="largeSentence"></p></header><main id="largeViewport" tabindex="0"><img id="largeDiagram" alt="当前句子的结构图"><p id="diagramError"></p></main></body></html>');d.close();
    let scale=1,manual=false,drag=null;const image=d.getElementById('largeDiagram'),viewport=d.getElementById('largeViewport');
    function zoom(value){scale=Math.max(.03,Math.min(5,value));if(image.naturalWidth)image.style.width=Math.round(image.naturalWidth*scale)+'px';d.getElementById('largeZoom').textContent=Math.round(scale*100)+'%';}
    function fit(){manual=false;zoom(Math.min(1,(viewport.clientWidth-32)/(image.naturalWidth||1),(viewport.clientHeight-32)/(image.naturalHeight||1)));viewport.scrollTo(0,0);}
    image.addEventListener('load',fit);image.draggable=false;child.addEventListener('resize',()=>{if(!manual)fit();});
    d.getElementById('fitDiagram').onclick=fit;d.getElementById('actualDiagram').onclick=()=>{manual=true;zoom(1);};d.getElementById('zoomIn').onclick=()=>{manual=true;zoom(scale*1.2);};d.getElementById('zoomOut').onclick=()=>{manual=true;zoom(scale/1.2);};
    d.getElementById('previousSentence').onclick=()=>navigate(Number(selected)-1);d.getElementById('nextSentence').onclick=()=>navigate(Number(selected)+1);
    viewport.addEventListener('wheel',event=>{event.preventDefault();manual=true;zoom(scale*(event.deltaY<0?1.1:1/1.1));},{passive:false});
    viewport.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();drag={x:event.clientX,y:event.clientY};viewport.setPointerCapture(event.pointerId);});viewport.addEventListener('pointermove',event=>{if(!drag)return;viewport.scrollLeft-=event.clientX-drag.x;viewport.scrollTop-=event.clientY-drag.y;drag={x:event.clientX,y:event.clientY};});viewport.addEventListener('pointerup',()=>{drag=null;});viewport.addEventListener('pointercancel',()=>{drag=null;});
    panel.classList.add('separate-diagram');applyWidths();button.textContent='结构图窗口已打开';status.textContent='把两个窗口分别拖到两块屏幕；关闭结构图窗口可恢复三栏';const vocabulary=document.getElementById('vocabularyButton');if(vocabulary)tools.append(vocabulary);renderChild();timer=root.setInterval(()=>{if(child?.closed)restore();},300);root.dispatchEvent(new Event('resize'));
   }catch{child.close();restore();status.textContent='无法建立结构图窗口，请允许本页弹窗后重试';}
  }
  button.addEventListener('click',openDiagram);const keyboard=event=>{if(event.ctrlKey&&event.altKey&&event.code==='KeyD'){event.preventDefault();openDiagram();}};root.addEventListener('keydown',keyboard);
  if(original)epub.showOriginal()?.catch(()=>{status.textContent='原版加载失败，请检查 EPUB 内容';});
  current={navigate,getDiagramWindow:()=>child,destroy(){destroyed=true;recapDialog?.remove();document.removeEventListener('study-sentence-selected',highlight);root.removeEventListener('keydown',keyboard);if(child&&!child.closed)child.close();restore();grips.forEach(grip=>grip.remove());translations.remove();tools.remove();panel.classList.remove('reading-workspace');document.body.classList.remove('reading-focus');toggle.hidden=false;}};
  return current;
 }
 root.ReadingWorkspace={mount,unmount(){current?.destroy();current=null;},getDiagramWindow:()=>current?.getDiagramWindow(),navigate:id=>current?.navigate(id)};
})(typeof window!=='undefined'?window:globalThis);
