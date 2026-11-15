'use strict';
const WINDOW_CHARACTERS=160000;
const BODY_BUDGET=110000;
const key=text=>text.normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
const promptUnit=({id,text,tag,kind,path,excerpt,part,parts})=>({id,text,tag,kind,document:path,...(excerpt?{excerpt:true}:{}),...(parts?{part,parts}: {})});

function windowsFor(units){
  const pieces=[];
  for(const unit of units){
    // A single unusually long paragraph is sent in numbered pieces; the source
    // paragraph and its only legal chapter boundary remain intact.
    const parts=Math.max(1,Math.ceil(unit.text.length/40000));
    for(let part=0;part<parts;part++)pieces.push(parts===1?unit:{...unit,text:unit.text.slice(part*40000,(part+1)*40000),part:part+1,parts});
  }
  const windows=[];let start=0;
  while(start<pieces.length){
    let end=start,size=0;
    while(end<pieces.length&&end-start<96){const length=JSON.stringify(promptUnit(pieces[end])).length+1;if(size+length>BODY_BUDGET)break;size+=length;end++;}
    if(end===start)throw new Error('EPUB 段落定位信息过长，无法安全提交目录检查；原文已保留');
    windows.push(pieces.slice(start,end));
    if(end===pieces.length)break;
    start=Math.max(start+1,end-4);
  }
  return windows;
}
function planBatches(input){
  const titles=new Set(input.originalDirectory.entries.map(e=>key(e.title)));
  const landmarks=input.units.filter(u=>/^h[1-6]$/.test(u.tag)||(u.text.length<=300&&titles.has(key(u.text))));
  if(input.characters<=500000||landmarks.length<2)return {mode:'full',windows:windowsFor(input.units)};
  // Every paragraph contributes evidence, including plain p/div chapter titles.
  // Long prose is explicitly excerpted; the model can request the original.
  const evidence=input.units.map(u=>u.text.length<=1600?u:{...u,text:u.text.slice(0,400)+'\n[…省略中间内容，仅用于目录核对…]\n'+u.text.slice(-400),excerpt:true});
  return {mode:'structure',windows:windowsFor(evidence)};
}
function directoryContext(input,units,windowIndex,windowCount){
  const entryKey=e=>JSON.stringify([e.title,e.depth||0,e.href,e.path,e.fragment]);
  const seen=new Set(),all=input.originalDirectory.entries.filter(e=>{const k=entryKey(e);if(seen.has(k))return false;seen.add(k);return true;});
  const labels=new Set(units.filter(u=>!u.excerpt&&u.text.length<=300).map(u=>key(u.text)));
  const relevant=all.filter(e=>labels.has(key(e.title)));
  const portion=Math.ceil(all.length/windowCount),slice=all.slice(windowIndex*portion,(windowIndex+1)*portion);
  const entries=[],added=new Set();let size=0;
  for(const e of [...relevant,...slice]){const k=entryKey(e);if(added.has(k))continue;const item={title:e.title,depth:e.depth||0,href:e.href,path:e.path,fragment:e.fragment};const length=JSON.stringify(item).length+1;if(size+length>28000)continue;size+=length;added.add(k);entries.push(item);}
  return {entries,totalEntries:all.length,entriesOmitted:entries.length<all.length,
    warnings:[...new Set(input.originalDirectory.warnings.map(w=>w.code))],
    pages:input.originalDirectory.pages.map(p=>({...p,text:p.text.slice(0,1000),truncated:p.truncated||p.text.length>1000})),pagesTruncated:input.originalDirectory.pagesTruncated};
}
module.exports={WINDOW_CHARACTERS,promptUnit,windowsFor,planBatches,directoryContext};
