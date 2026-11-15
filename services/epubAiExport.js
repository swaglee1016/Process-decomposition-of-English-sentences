'use strict';
const AdmZip=require('adm-zip');
const {DOMParser,XMLSerializer}=require('@xmldom/xmldom');
const path=require('node:path').posix;
const OPF='http://www.idpf.org/2007/opf';
const escapeXml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
function xml(source) {
  if(/<!ENTITY\b/i.test(source))throw new Error('EPUB XML 不支持实体声明');
  return new DOMParser({onError:()=>{throw new Error('EPUB 目录文件无法解析');}}).parseFromString(source,'application/xml');
}
function nodes(root,name){return Array.from(root.getElementsByTagName('*')).filter(n=>(n.localName||n.nodeName.split(':').at(-1))===name);}
function href(from,to){return path.relative(path.dirname(from),to).split('/').map(encodeURIComponent).join('/');}
function safeOriginalHref(zip,opfPath,value){
  try{
    if(typeof value!=='string'||/[\\\x00-\x20]/.test(value))return null;
    const hash=value.indexOf('#'),rawFile=(hash<0?value:value.slice(0,hash)).split('?')[0];
    const file=decodeURIComponent(rawFile),fragment=hash<0?'':decodeURIComponent(value.slice(hash+1));
    if(!file||/^[a-z][a-z0-9+.-]*:|^\//i.test(file)||/[\\\x00-\x1f:]/.test(file+fragment))return null;
    const target=path.normalize(path.join(path.dirname(opfPath),file));
    if(target==='..'||target.startsWith('../'))return null;
    const entry=zip.getEntry(target);
    if(!entry||entry.isDirectory||entry.header.size>8*1024*1024)return null;
    if(fragment){
      const tree=require('htmlparser2').parseDocument(entry.getData().toString('utf8'));
      const stack=[tree];let count=0,found=false;
      while(stack.length){const node=stack.pop();if(++count>100000)return null;if(node.attribs?.id===fragment||node.attribs?.name===fragment)found=true;for(const child of node.children||[])stack.push(child);}
      if(!found)return null;
    }
    return href(opfPath,target)+(fragment?'#'+encodeURIComponent(fragment):'');
  }catch{return null;}
}
function exportDirectory(source,input,sections,sourceHash) {
  const original=new AdmZip(source);
  const container=xml(original.readAsText('META-INF/container.xml'));
  const opfPath=nodes(container,'rootfile')[0]?.getAttribute('full-path');
  if(!opfPath||!original.getEntry(opfPath))throw new Error('EPUB 缺少内容清单');
  const opf=xml(original.readAsText(opfPath)),root=opf.documentElement;
  const manifest=nodes(opf,'manifest')[0],spine=nodes(opf,'spine')[0],metadata=nodes(opf,'metadata')[0];
  if(!manifest||!spine||!metadata)throw new Error('EPUB 内容清单不完整');
  const prefix='study-ai-'+sourceHash.slice(0,16);
  const base=path.dirname(opfPath);
  let stem=prefix,serial=0;
  while(original.getEntry(path.join(base,stem+'.xhtml'))||original.getEntry(path.join(base,stem+'.ncx')))stem=prefix+'-'+(++serial);
  const navPath=path.join(base,stem+'.xhtml'),ncxPath=path.join(base,stem+'.ncx');
  const ids=new Set(nodes(opf,'item').map(n=>n.getAttribute('id')));
  function uniqueId(value){let id=value,i=0;while(ids.has(id))id=value+'-'+(++i);ids.add(id);return id;}
  const navId=uniqueId(stem+'-nav'),ncxId=uniqueId(stem+'-ncx');
  const oldTocs=new Set();
  const guides=nodes(opf,'guide'),guide=guides[0]||root.appendChild(opf.createElementNS(OPF,'guide'));
  for(const ref of nodes(guide,'reference'))if(ref.getAttribute('type')==='toc')oldTocs.add(ref.getAttribute('href'));
  for(const item of nodes(manifest,'item')){
    const properties=(item.getAttribute('properties')||'').split(/\s+/).filter(Boolean);
    if(properties.includes('nav')){
      oldTocs.add(item.getAttribute('href'));
      const rest=properties.filter(p=>p!=='nav');
      if(rest.length)item.setAttribute('properties',rest.join(' '));else item.removeAttribute('properties');
    }
  }
  for(const target of [...oldTocs]){oldTocs.delete(target);const safe=safeOriginalHref(original,opfPath,target);if(safe)oldTocs.add(safe);}
  const setMeta=(name,value)=>{
    const meta=opf.createElementNS(OPF,'meta');meta.setAttribute('name',name);meta.setAttribute('content',value);metadata.appendChild(meta);
  };
  setMeta('sentence-process:ai-directory','1');
  setMeta('sentence-process:directory-repaired','1');
  setMeta('sentence-process:ai-source',sourceHash);
  for(const target of oldTocs)setMeta('sentence-process:original-toc',target);
  const isEpub3=/^3(?:\.|$)/.test(root.getAttribute('version'));
  const navItem=opf.createElementNS(OPF,'item');
  navItem.setAttribute('id',navId);navItem.setAttribute('href',href(opfPath,navPath));navItem.setAttribute('media-type','application/xhtml+xml');
  if(isEpub3)navItem.setAttribute('properties','nav');
  manifest.insertBefore(navItem,manifest.firstChild);
  const ncxItem=opf.createElementNS(OPF,'item');
  ncxItem.setAttribute('id',ncxId);ncxItem.setAttribute('href',href(opfPath,ncxPath));ncxItem.setAttribute('media-type','application/x-dtbncx+xml');manifest.appendChild(ncxItem);
  spine.setAttribute('toc',ncxId);
  const navRef=opf.createElementNS(OPF,'itemref');navRef.setAttribute('idref',navId);navRef.setAttribute('linear','no');spine.appendChild(navRef);
  const tocRefs=nodes(guide,'reference').filter(n=>n.getAttribute('type')==='toc');
  const toc=tocRefs[0]||guide.appendChild(opf.createElementNS(OPF,'reference'));
  toc.setAttribute('type','toc');toc.setAttribute('title','Contents');toc.setAttribute('href',href(opfPath,navPath));
  // Keep any additional original guide entries, but do not treat them as competing TOCs.
  for(const extra of tocRefs.slice(1))extra.setAttribute('type','other.original-toc');
  const patched=new Map(),links=[];
  for(const [index,section] of sections.entries()){
    const unit=input.units[section.start];
    let id=prefix+'-p'+unit.id;
    const document=input.documents.get(unit.path);
    while(document.ids.has(id))id+='-a';
    document.ids.add(id);
    const entry={offset:unit.offset,html:'<span id="'+id+'"></span>'};
    if(!patched.has(unit.path))patched.set(unit.path,[]);
    patched.get(unit.path).push(entry);
    links.push({title:section.title||'Section '+(index+1),depth:section.depth??0,kind:section.kind||'other',path:unit.path,id});
  }
  const replacements=new Map();
  for(const [filename,edits] of patched){
    let html=input.documents.get(filename).html;
    for(const edit of edits.sort((a,b)=>b.offset-a.offset))html=html.slice(0,edit.offset)+edit.html+html.slice(edit.offset);
    replacements.set(filename,Buffer.from(html));
  }
  const roots=[],stack=[];
  for(const [index,link] of links.entries()){
    const node={...link,index,children:[]};stack.length=link.depth;
    (link.depth?stack[link.depth-1].children:roots).push(node);stack.push(node);
  }
  const htmlList=items=>items.map(link=>'<li><a class="study-kind-'+escapeXml(link.kind)+'" href="'+escapeXml(href(navPath,link.path)+'#'+link.id)+'">'+escapeXml(link.title)+'</a>'+(link.children.length?'<ol>'+htmlList(link.children)+'</ol>':'')+'</li>').join('\n');
  const list=htmlList(roots);
  const oldLinks=[...oldTocs].map(target=>'<li><a href="'+escapeXml(target)+'">原书目录</a></li>').join('');
  let navHtml='<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh" xml:lang="zh"><head><title>Contents</title></head><body><h1>Contents</h1><p>AI 根据原文修复目录；保留原书标题与层级，无标题的材料使用 Section 编号，正文保持不变。</p><nav epub:type="toc" id="toc"><ol>'+list+'</ol></nav>'+(oldLinks?'<aside><h2>保留的原目录</h2><ul>'+oldLinks+'</ul></aside>':'')+'</body></html>';
  if(!isEpub3)navHtml=navHtml.replace('<!DOCTYPE html>','<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">').replace(' xmlns:epub="http://www.idpf.org/2007/ops"','').replace(' lang="zh"','').replace('<nav epub:type="toc" id="toc">','<div id="toc">').replace('</nav>','</div>').replace('<aside>','<div>').replace('</aside>','</div>');
  const identifierId=root.getAttribute('unique-identifier');
  const identifier=nodes(opf,'identifier').find(n=>n.getAttribute('id')===identifierId)?.textContent||sourceHash;
  const ncxList=items=>items.map(link=>'<navPoint class="study-kind-'+escapeXml(link.kind)+'" id="ai-'+link.index+'" playOrder="'+(link.index+1)+'"><navLabel><text>'+escapeXml(link.title)+'</text></navLabel><content src="'+escapeXml(href(ncxPath,link.path)+'#'+link.id)+'"/>'+ncxList(link.children)+'</navPoint>').join('');
  const points=ncxList(roots);
  const ncx='<?xml version="1.0" encoding="UTF-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="'+escapeXml(identifier)+'"/><meta name="dtb:depth" content="1"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head><docTitle><text>'+escapeXml(input.title)+'（AI 阅读目录）</text></docTitle><navMap>'+points+'</navMap></ncx>';
  replacements.set(opfPath,Buffer.from(new XMLSerializer().serializeToString(opf)));
  replacements.set(navPath,Buffer.from(navHtml));replacements.set(ncxPath,Buffer.from(ncx));
  const result=repack(original,replacements),verified=new AdmZip(result);
  // Compare original archive payloads independently of the text parser. Apart
  // from package navigation metadata, only our exact empty anchors may differ.
  for(const entry of original.getEntries()){
    if(entry.isDirectory||['mimetype',opfPath].includes(entry.entryName))continue;
    let actual=verified.readFile(entry.entryName);
    if(!actual)throw new Error('EPUB 原文件完整性校验失败，未保存结果');
    if(patched.has(entry.entryName)){
      let content=actual.toString('utf8');
      for(const edit of patched.get(entry.entryName)){
        if(content.split(edit.html).length!==2)throw new Error('EPUB 正文锚点完整性校验失败，未保存结果');
        content=content.replace(edit.html,'');
      }
      actual=Buffer.from(content,'utf8');
    }
    if(!actual.equals(entry.getData()))throw new Error('EPUB 原文件完整性校验失败，未保存结果');
  }
  return result;
}
function repack(original,replacements){
  // EPUB requires the first ZIP entry to be an uncompressed mimetype.
  const output=new AdmZip({noSort:true});
  output.addFile('mimetype',Buffer.from('application/epub+zip'));
  output.getEntry('mimetype').header.method=0;
  let total=0;
  for(const entry of original.getEntries()){
    if(entry.entryName==='mimetype'||entry.isDirectory)continue;
    total+=entry.header.size;
    if(entry.header.size>32*1024*1024||total>160*1024*1024)throw new Error('EPUB 导出资源超过限制');
    output.addFile(entry.entryName,replacements.get(entry.entryName)||entry.getData());
    replacements.delete(entry.entryName);
  }
  for(const [filename,data] of replacements)output.addFile(filename,data);
  return output.toBuffer();
}

function renumberGeneratedDirectory(source){
  const original=new AdmZip(source),container=xml(original.readAsText('META-INF/container.xml'));
  const opfPath=nodes(container,'rootfile')[0]?.getAttribute('full-path');
  if(!opfPath||!original.getEntry(opfPath))throw new Error('EPUB 缺少内容清单');
  const opf=xml(original.readAsText(opfPath));
  if(!nodes(opf,'meta').some(n=>n.getAttribute('name')==='sentence-process:ai-directory'&&n.getAttribute('content')==='1'))return null;
  const sourceHash=nodes(opf,'meta').find(n=>n.getAttribute('name')==='sentence-process:ai-source')?.getAttribute('content');
  if(!/^[a-f0-9]{64}$/.test(sourceHash||''))return null;
  const prefix='study-ai-'+sourceHash.slice(0,16);
  const items=nodes(opf,'item'),spine=nodes(opf,'spine')[0];
  const navItem=items.find(n=>(n.getAttribute('properties')||'').split(/\s+/).includes('nav'));
  const guide=nodes(opf,'reference').find(n=>n.getAttribute('type')==='toc');
  const ncxItem=items.find(n=>n.getAttribute('id')===spine?.getAttribute('toc'));
  function target(value){
    const safe=safeOriginalHref(original,opfPath,value);
    if(!safe)return null;
    return path.normalize(path.join(path.dirname(opfPath),decodeURIComponent(safe.split('#')[0])));
  }
  const navPath=target(navItem?.getAttribute('href')||guide?.getAttribute('href'));
  const ncxPath=target(ncxItem?.getAttribute('href'));
  if(!navPath||!ncxPath)return null;
  const stem=path.basename(navPath,'.xhtml');
  if(!new RegExp('^'+prefix+'(?:-[1-9][0-9]*)?$').test(stem)||
    path.dirname(navPath)!==path.dirname(opfPath)||ncxPath!==path.join(path.dirname(navPath),stem+'.ncx'))return null;
  const html=xml(original.readAsText(navPath)),ncx=xml(original.readAsText(ncxPath));
  const toc=nodes(html,'nav').find(n=>n.getAttribute('epub:type')==='toc')||
    nodes(html,'div').find(n=>n.getAttribute('id')==='toc');
  if(!toc)throw new Error('EPUB 缺少 AI 阅读目录');
  const anchors=nodes(toc,'a'),points=nodes(ncx,'navPoint');
  if(anchors.length<2||anchors.length!==points.length)throw new Error('EPUB AI 目录条目不一致');
  for(const [index,anchor] of anchors.entries()){
    const hrefValue=anchor.getAttribute('href'),content=nodes(points[index],'content')[0];
    if(!hrefValue||content?.getAttribute('src')!==hrefValue||
      !new RegExp('#'+prefix+'-p[0-9]+(?:-a)*$').test(hrefValue)||
      !safeOriginalHref(original,navPath,hrefValue))return null;
  }
  for(const [index,anchor] of anchors.entries()){
    anchor.textContent='Section '+(index+1);
    const label=nodes(points[index],'navLabel')[0],text=label&&nodes(label,'text')[0];
    if(!text)throw new Error('EPUB AI 目录标签无效');
    text.textContent='Section '+(index+1);
  }
  for(const title of [...nodes(html,'title'),...nodes(html,'h1')])if(title.textContent==='AI 阅读目录')title.textContent='Contents';
  const notice=nodes(html,'p')[0];
  if(notice?.textContent==='以下小节和标题由 AI 根据正文生成，不是原书章目；原文保持不变。')
    notice.textContent='AI 仅选择阅读分节位置；Section 编号不代表原书章名，原文保持不变。';
  if(guide)guide.setAttribute('title','Contents');
  const serializer=new XMLSerializer(),replacements=new Map([
    [opfPath,Buffer.from(serializer.serializeToString(opf))],
    [navPath,Buffer.from(serializer.serializeToString(html))],
    [ncxPath,Buffer.from(serializer.serializeToString(ncx))]
  ]);
  return repack(original,replacements);
}
module.exports={exportDirectory,renumberGeneratedDirectory};
