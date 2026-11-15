// Structural navigation inspection. No network, filesystem entity resolution or
// book-supplied JavaScript is used by either parser.
const {DOMParser} = require('@xmldom/xmldom');
const {parseDocument} = require('htmlparser2');

const DC = 'http://purl.org/dc/elements/1.1/';
const EPUB = 'http://www.idpf.org/2007/ops';
const MAX_NODES = 100000;
const MAX_ENTRIES = 4000;
const local = node => String(node.localName || node.name || node.nodeName || '').split(':').at(-1).toLowerCase();
const children = node => Array.from(node.childNodes || node.children || []);
function walk(root) {
  const result=[],stack=[[root,0]];
  while(stack.length){const [node,depth]=stack.pop();if(depth>256)throw new Error('EPUB 文档嵌套层级超过限制');result.push(node);if(result.length>MAX_NODES)throw new Error('EPUB 文档节点数量超过限制');const list=children(node);for(let i=list.length-1;i>=0;i--)stack.push([list[i],depth+1]);}
  return result;
}
const elements = root => walk(root).filter(node=>node.nodeType===1 || node.type==='tag');
const find = (root,name) => elements(root).find(node=>local(node)===name);
const direct = (root,name) => children(root).find(node=>local(node)===name);
function text(node) {return walk(node).filter(n=>n.nodeType===3||n.nodeType===4||n.type==='text').map(n=>n.data || n.nodeValue || '').join('').replace(/\s+/g,' ').trim();}
// Ignore linked superscript note markers only when comparing directory labels.
function headingLabel(node) {
  return normalize(walk(node).filter(n=>n.type==='text'&&!ancestors(n).some(p=>
    local(p)==='sup'&&ancestor(p,a=>local(a)==='a'&&attr(a,'href')))).map(n=>n.data).join(''));
}
const attr = (node,name) => node?.getAttribute ? node.getAttribute(name) || '' : node?.attribs?.[name] || '';
const normalize = value => String(value).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const titleIdentity = value => normalize(value).replace(/^the /,'');
function bookTitleIdentities(title, authorNames) {
  const identities=new Set([titleIdentity(title)]);
  const authors=new Set(authorNames.map(normalize).filter(Boolean));
  // Remove only a separator-delimited author explicitly identified by metadata.
  // Other names and genuine title/subtitle separators remain part of the title.
  for(const match of title.matchAll(/\s+[-–—]\s+|[:：]\s*/g)) {
    const before=title.slice(0,match.index).trim(),after=title.slice(match.index+match[0].length).trim();
    if(before&&after&&authors.has(normalize(before)))identities.add(titleIdentity(after));
    if(before&&after&&authors.has(normalize(after)))identities.add(titleIdentity(before));
  }
  return identities;
}
const excluded = node => /(?:^|\s)(?:sigilnotintoc|sigil_not_in_toc)(?:\s|$)/i.test(attr(node,'class'));
const dirOf = value => value.includes('/')?value.slice(0,value.lastIndexOf('/')):'';

function xml(source) {
  if (/<!ENTITY\b/i.test(source)) throw new Error('EPUB XML 不支持实体声明');
  let count=0;for(const _ of source.matchAll(/</g))if(++count>MAX_NODES)throw new Error('EPUB XML 节点数量超过限制');
  const document=new DOMParser({xmlns:{dc:DC},onError:(level)=>{throw new Error(`EPUB XML ${level}`);}}).parseFromString(source,'application/xml');
  elements(document);return document;
}

function resolveTarget(sourcePath, href) {
  if (!href || /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(href.trim())) return null;
  try {
    const hash=href.indexOf('#'),file=(hash<0?href:href.slice(0,hash)).split('?')[0];
    const fragment=hash<0?'':decodeURIComponent(href.slice(hash+1));
    const decoded=decodeURIComponent(file);
    if (decoded.includes('\\') || /[\x00-\x1f]/.test(decoded+fragment)) return null;
    const parts=file ? (dirOf(sourcePath)+'/'+decoded).split('/') : sourcePath.split('/');
    const out=[];
    for(const part of parts){if(!part||part==='.')continue;if(part==='..'){if(!out.length)return null;out.pop();}else out.push(part);}
    const path=out.join('/');return path?{path,fragment}:null;
  } catch {return null;}
}

function packageInfo(readFile) {
  const container=readFile('META-INF/container.xml');
  if(!container)throw new Error('无法解析 EPUB 文件：找不到内容清单（OPF）');
  const root=find(xml(container),'rootfile'),path=attr(root,'full-path');
  const source=path&&readFile(path);
  if(!source)throw new Error('无法解析 EPUB 文件：找不到内容清单（OPF）');
  const tree=xml(source),manifestNode=find(tree,'manifest'),spineNode=find(tree,'spine'),metadata=find(tree,'metadata');
  const metadataElements=metadata?elements(metadata):[];
  const titleNode=metadataElements.find(n=>local(n)==='title'&&(!n.namespaceURI||n.namespaceURI===DC));
  const creatorNodes=metadataElements.filter(n=>local(n)==='creator'&&(!n.namespaceURI||n.namespaceURI===DC));
  const creators=creatorNodes.map(text);
  const authorNames=[...new Set([...creators,...creatorNodes.map(n=>n.getAttributeNS('http://www.idpf.org/2007/opf','file-as')).filter(Boolean)])];
  const manifest=children(manifestNode||{}).filter(n=>local(n)==='item').map(n=>({id:attr(n,'id'),href:attr(n,'href'),mediaType:attr(n,'media-type'),properties:attr(n,'properties')}));
  const byId=new Map(manifest.map(item=>[item.id,item]));
  const spine=children(spineNode||{}).filter(n=>local(n)==='itemref').map(n=>{
    const item=byId.get(attr(n,'idref'));
    if(!item)throw new Error('EPUB 阅读顺序引用了缺失的文件，无法确认正文完整性');
    return item;
  });
  const guideNode=find(tree,'guide');
  const guide=children(guideNode||{}).filter(n=>local(n)==='reference').map(n=>({type:attr(n,'type'),href:attr(n,'href')}));
  const metadataTags=metadataElements.filter(n=>local(n)==='meta');
  const aiDirectory=metadataTags.some(n=>attr(n,'name')==='sentence-process:ai-directory'&&attr(n,'content')==='1');
  const originalTocs=metadataTags.filter(n=>attr(n,'name')==='sentence-process:original-toc').map(n=>attr(n,'content'));
  const repaired=metadataTags.some(n=>attr(n,'name')==='sentence-process:directory-repaired'&&attr(n,'content')==='1');
  return {path,title:titleNode?text(titleNode):'',creators,authorNames,manifest,spine,guide,ncxId:attr(spineNode,'toc'),aiDirectory,repaired,originalTocs};
}

function inspectNavigation(readFile, htmlToText, additionalPaths=[]) {
  const meta=packageInfo(readFile),warnings=[],cache=new Map();
  let bookNodes=0,sourceEntries=0,sourcesStopped=false;
  const seenSources=new Set();
  const warn=(code,message,details={})=>{if(warnings.length<200)warnings.push({code,message,...details});};
  const guideTargets=meta.guide.map(item=>({...item,target:resolveTarget(meta.path,item.href)}));
  const navPaths=new Set(meta.manifest.filter(m=>/\bnav\b/.test(m.properties)).map(m=>resolveTarget(meta.path,m.href)?.path).filter(Boolean));
  for(const item of guideTargets)if(['toc','other.original-toc'].includes(item.type)&&item.target)navPaths.add(item.target.path);
  for(const href of meta.originalTocs){const target=resolveTarget(meta.path,href);if(target)navPaths.add(target.path);}
  const authorIdentities=new Set(meta.authorNames.flatMap(name=>[normalize(name),normalize('By '+name)]));
  const titleIdentities=bookTitleIdentities(meta.title,meta.authorNames);
  const titleVariants=new Set([...titleIdentities].flatMap(title=>[title,...['','By '].map(by=>titleIdentity(title+' '+by+meta.creators.join(' ')))]));

  function documentAt(path) {
    if(cache.has(path))return cache.get(path);
    const html=readFile(path);if(html===null){cache.set(path,null);return null;}
    const tree=parseDocument(html,{withStartIndices:true,withEndIndices:true,recognizeSelfClosing:true});
    const allNodes=walk(tree);bookNodes+=allNodes.length;
    if(bookNodes>200000)throw new Error('EPUB 累计节点数量超过限制，请分册处理');
    const nodes=allNodes.filter(n=>n.type==='tag'),body=nodes.find(n=>local(n)==='body'),scope=body||tree;
    const namespaces=new Map(nodes.filter(n=>local(n)==='html').flatMap(n=>Object.entries(n.attribs||{}).filter(([k])=>k.startsWith('xmlns:')).map(([k,v])=>[k.slice(6),v])));
    function types(node){return Object.entries(node.attribs||{}).filter(([k])=>k==='epub:type'||(k.endsWith(':type')&&namespaces.get(k.split(':')[0])===EPUB)).flatMap(([,v])=>v.split(/\s+/));}
    const anchors=new Map();
    for(const node of nodes)for(const name of [attr(node,'id'),attr(node,'name')])if(name&&!anchors.has(name))anchors.set(name,node);
    const bodyText=htmlToText(html);
    const refs=guideTargets.filter(r=>r.target?.path===path&&!r.target.fragment).map(r=>r.type);
    const bodyTypes=types(body||{});
    let kind=navPaths.has(path)?'navigation':'body';
    if(refs.includes('cover')||bodyTypes.includes('cover'))kind='cover';
    else if(refs.some(t=>/^(?:other\.)?(?:title-?page|copyright-page|dedication|acknowledgments)$/.test(t))||bodyTypes.some(t=>/^(?:frontmatter|titlepage|copyright-page|dedication)$/.test(t))||
      (meta.title&&titleVariants.has(titleIdentity(bodyText)))||authorIdentities.has(normalize(bodyText)))kind='frontmatter';
    else if(refs.some(t=>/^(?:bibliography|index|glossary)$/.test(t))||bodyTypes.includes('backmatter'))kind='backmatter';
    // A TOC reference identifies a location, not permission to discard its whole file.
    // Keep mixed TOC/prose documents in the content stream. Only heading/link-only
    // navigation pages (and our known legacy explanatory notice) are excluded.
    if(navPaths.has(path)){
      const legacyNotices=new Set(['AI 根据原文修复目录；保留原书标题与层级，无标题的材料使用 Section 编号，正文保持不变。','AI 仅选择阅读分节位置；Section 编号不代表原书章名，原文保持不变。','以下小节和标题由 AI 根据正文生成，不是原书章目；原文保持不变。']);
      const prose=allNodes.some(n=>n.type==='text'&&n.data.trim()&&n.startIndex>=(body?.startIndex??0)&&
        !ancestor(n,p=>['head','style','script','a'].includes(local(p))||/^h[1-6]$/.test(local(p))||(local(p)==='p'&&legacyNotices.has(text(p)))));
      kind=prose?'body':'navigation';
    }
    const auxiliaryOnly=titleVariants.has(titleIdentity(bodyText))||authorIdentities.has(normalize(bodyText));
    if(kind==='cover'&&bodyText&&!auxiliaryOnly)kind='frontmatter';
    const doc={id:'',path,html,text:bodyText,kind,order:-1,start:body?.startIndex??0,end:(body?.endIndex??(html.length-1))+1,
      tree,nodes,scope,anchors,types,auxiliaryOnly,atoms:allNodes.filter(n=>n.type==='text'&&n.data.trim()&&n.startIndex>=(body?.startIndex??0)&&!ancestor(n,p=>['head','style','script'].includes(local(p)))).map(n=>({start:n.startIndex,end:n.endIndex+1,text:n.data}))};
    cache.set(path,doc);return doc;
  }
  const documents=[];
  if(meta.spine.length>400)throw new Error('EPUB 阅读文件数量超过 400 个，请分册处理');
  for(const item of meta.spine){const target=resolveTarget(meta.path,item.href),doc=target&&documentAt(target.path);if(!doc)throw new Error('EPUB 书内有无法读取或缺失的文件，无法确认正文完整性');if(doc.order>=0)continue;doc.order=documents.length;doc.id='document-'+doc.order;documents.push(doc);}
  if(!documents.length)throw new Error('无法解析 EPUB 文件：书中没有可读取的内容');

  function position(sourcePath,entry) {
    const target=entry.target || resolveTarget(sourcePath,entry.href);
    const doc=target&&documentAt(target.path);
    const node=doc&&target.fragment?doc.anchors.get(target.fragment):null;
    if(!target||!doc||doc.order<0||(target.fragment&&!node)){
      warn('invalid-target','目录中存在无法定位的链接',{title:entry.title});return null;
    }
    if(doc.kind==='cover'||doc.kind==='navigation')return null;
    const start=entry.offset??node?.startIndex??doc.start;
    if(start<doc.start||start>=doc.end){warn('invalid-target','目录目标不在可读内容中',{title:entry.title});return null;}
    if(node&&excluded(node))warn('excluded-heading-reference','原书目录引用了带排除标记的标题，已保留原目录',{title:entry.title});
    return {...entry,target:{path:target.path,fragment:target.fragment},doc,start,key:contentKey(doc,start)};
  }
  const sources=[];
  function addSource(source,path,extract){
    if(!path||sourcesStopped||seenSources.has(source+'\n'+path))return;
    if(seenSources.size>=32||sourceEntries>=MAX_ENTRIES){sourcesStopped=true;warn('navigation-source-limit','目录检查未完成：来源数量超过限制，当前仅显示已检查结果');return;}
    seenSources.add(source+'\n'+path);
    try{const html=readFile(path);if(html===null)throw new Error('missing');const raw=extract(html);sourceEntries+=raw.length;if(sourceEntries>MAX_ENTRIES){sourcesStopped=true;warn('navigation-source-limit','目录检查未完成：条目数量超过限制，当前仅显示已检查结果');return;}const entries=raw.map(entry=>position(path,{...entry,source})).filter(Boolean);sources.push({source,path,entries,raw});}
    catch{warn('invalid-navigation','书内目录无法可靠解析，已保留阅读预览入口',{source});}
  }
  for(const item of meta.manifest.filter(m=>/\bnav\b/.test(m.properties))){const path=resolveTarget(meta.path,item.href)?.path;addSource('nav',path,html=>{
    const parsed=parseDocument(html),nodes=elements(parsed),nav=nodes.find(n=>local(n)==='nav'&&(/\btoc\b/.test(Object.entries(n.attribs||{}).filter(([k])=>k.endsWith(':type')).map(([,v])=>v).join(' '))||attr(n,'role')==='doc-toc'));
    if(!nav)throw new Error('missing toc navigation');return htmlLinks(nav);
  });}
  const ncx=meta.manifest.find(m=>m.id===meta.ncxId)||meta.manifest.find(m=>m.mediaType==='application/x-dtbncx+xml');
  if(ncx)addSource('ncx',resolveTarget(meta.path,ncx.href)?.path,source=>{
    const tree=xml(source),map=find(tree,'navmap');if(local(tree.documentElement)!=='ncx'||!map)throw new Error('invalid NCX root');
    return elements(map).filter(n=>local(n)==='navpoint').map(node=>({title:text(direct(node,'navlabel')||{}),href:attr(direct(node,'content'),'src'),kind:directoryKind(node),depth:ancestors(node).filter(n=>local(n)==='navpoint').length})).filter(e=>e.title&&e.href);
  });
  for(const item of guideTargets.filter(r=>r.type==='toc'&&r.target))addSource('html-toc',item.target.path,html=>{
    const tree=parseDocument(html);const scope=find(tree,'body')||tree;
    const toc=elements(scope).find(n=>(local(n)==='nav'&&/\btoc\b/.test(attr(n,'epub:type')))||(meta.aiDirectory&&local(n)==='div'&&attr(n,'id')==='toc'));
    return htmlLinks(toc||scope);
  });

  const primary=sources.find(s=>s.entries.length);
  if(primary&&!meta.aiDirectory){
    const headings=documents.flatMap(doc=>doc.nodes.filter(n=>/^h[1-6]$/.test(local(n))).map(node=>({doc,node,label:headingLabel(node),key:contentKey(doc,node.startIndex)})));
    for(const [index,entry] of primary.entries.entries()){
      const previous=primary.entries[index-1];
      if(previous&&(entry.doc.order<previous.doc.order||(entry.doc===previous.doc&&entry.start<previous.start)))
        warn('source-conflict','目录顺序与正文阅读顺序不一致，需要修复',{title:entry.title});
      const atTarget=headings.find(h=>h.doc===entry.doc&&h.node.startIndex>=entry.start&&!hasTextBetween(entry.doc.atoms,entry.start,h.node.startIndex));
      const following=atTarget&&headings[headings.indexOf(atTarget)+1];
      const adjacent=following?.doc===entry.doc&&atTarget&&!hasTextBetween(entry.doc.atoms,atTarget.node.endIndex+1,following.node.startIndex);
      const combined=adjacent?atTarget.label+' '+following.label:'';
      if(atTarget&&atTarget.label!==normalize(entry.title)&&combined!==normalize(entry.title)&&headings.some(h=>h.label===normalize(entry.title)&&h.key!==atTarget.key))
        warn('source-conflict','目录标题指向了另一个正文标题，需要修复',{title:entry.title});
    }
  }
  const headingCandidates=[];
  for(const doc of documents){
    if(doc.kind!=='body'||(meta.aiDirectory&&primary))continue;
    const rawHeadings=doc.nodes.filter(n=>/^h[1-6]$/.test(local(n)));
    if(rawHeadings.length+headingCandidates.length>1000)throw new Error('EPUB 标题数量超过限制，请分册处理');
    for(const node of rawHeadings){
      const label=text(node);if(!label||ancestor(node,excluded)||authorIdentities.has(normalize(label))||/_split_\d+/i.test(label))continue;
      // A file/section link already starts at its first heading. Do not invent
      // a competing boundary between the wrapper and that heading.
      if(primary?.entries.some(entry=>entry.doc===doc&&entry.start<=node.startIndex&&
        !hasTextBetween(doc.atoms,entry.start,node.startIndex)))continue;
      const semantic=ancestor(node,n=>doc.types(n).includes('chapter'));
      if(!semantic&&meta.title&&titleIdentities.has(titleIdentity(label)))continue;
      if(!doc.atoms.length||doc.atoms.at(-1).start<=node.endIndex)continue;
      const ordinal=chapterNumber(label);
      headingCandidates.push({title:label,depth:0,source:'headings',target:{path:doc.path,fragment:attr(node,'id')},offset:node.startIndex,level:Number(local(node).slice(1)),ordinal,semantic:!!semantic,doc,start:node.startIndex,key:contentKey(doc,node.startIndex)});
    }
  }
  const numbered=headingCandidates.filter(h=>h.ordinal!==null);
  const reliable=new Set(headingCandidates.filter(h=>h.semantic));
  const numberedGroups=new Map();for(const h of numbered){if(!numberedGroups.has(h.level))numberedGroups.set(h.level,[]);numberedGroups.get(h.level).push(h);}
  for(const same of numberedGroups.values())if(same.length>1&&same.every((item,index)=>!index||item.ordinal>same[index-1].ordinal))for(const h of same)reliable.add(h);
  let entries=primary?primary.entries:headingCandidates.filter(h=>reliable.has(h));
  let source=primary?.source || (entries.length?'headings':null);
  const selectedKeys=new Set(entries.map(e=>e.key)),candidateMap=new Map();
  for(const h of headingCandidates)if(!selectedKeys.has(h.key))candidateMap.set(h.key,h);
  if(primary){
    for(const other of sources.filter(s=>s!==primary))for(const item of other.entries){
      const same=entries.find(e=>e.key===item.key&&e.title===item.title)||entries.find(e=>e.key===item.key);
      if(same&&same.title.toLowerCase()!==item.title.toLowerCase())warn('source-conflict','不同目录来源的标题不一致，保留优先来源',{title:same.title});
      if(!same){candidateMap.set(item.key,item);warn('source-conflict','其他目录来源提供了未列出的条目，请核对目录完整性');}
    }
  }
  const candidates=[...candidateMap.values()];
  if(entries.length+candidates.length>1600)throw new Error('EPUB 目录和候选标题总数超过限制，请分册处理');
  const allEntries=[...entries,...candidates];
  const compare=(a,b)=>a.doc.order-b.doc.order||a.start-b.start;
  for(const list of [entries,candidates])for(let i=0;i<list.length;i++){
    const entry=list[i];entry.group=false;
    for(let j=i+1;j<list.length&&list[j].depth>entry.depth;j++)if(entry.key===list[j].key){entry.group=true;break;}
  }
  const confirmed=new Set(entries);
  function ranges(entry) {
    if(entry.group)return [];
    const entryHeading=entry.doc.nodes.find(n=>n.startIndex===entry.start&&/^h[1-6]$/.test(local(n)));
    const level=entry.level || (entryHeading?Number(local(entryHeading).slice(1)):6);
    const ordinal=chapterNumber(entry.title);
    // An unlisted subtitle or local heading stays with its visible directory
    // entry. Only independent chapter evidence may interrupt that entry.
    const later=allEntries.filter(other=>!other.group&&other.key!==entry.key&&compare(other,entry)>0&&
      (confirmed.has(other)||(ordinal!==null&&other.ordinal===ordinal+1)||
       (!confirmed.has(entry)&&(other.source!=='headings'||reliable.has(other)||other.level<=level)))).sort(compare);
    const next=later[0],result=[];
    for(let index=entry.doc.order;index<documents.length;index++){
      const doc=documents[index];if(next&&index>next.doc.order)break;
      if(index!==entry.doc.order){
        if(meta.aiDirectory&&['cover','navigation'].includes(doc.kind))continue;
        if(!meta.aiDirectory&&['cover','navigation','frontmatter','backmatter'].includes(doc.kind))break;
        if(!meta.aiDirectory&&!next&&!sameSplitFamily(entry.doc.path,doc.path)&&!doc.types(doc.scope).includes('bodymatter'))break;
      }
      const start=index===entry.doc.order?entry.start:doc.start,end=next&&index===next.doc.order?next.start:doc.end;
      const hasContent=doc.atoms.some(atom=>atom.start>=start&&atom.end<=end)||doc.nodes.some(node=>['img','image'].includes(local(node))&&node.startIndex>=start&&node.startIndex<end);
      if(end>start&&hasContent){
        result.push({path:doc.path,start,end});
        if(index!==entry.doc.order&&!meta.aiDirectory&&!sameSplitFamily(entry.doc.path,doc.path))warn('inferred-continuation','章节包含按阅读顺序定位的续页，请检查起止范围',{path:doc.path});
      }
      if(next&&index===next.doc.order)break;
    }
    return result;
  }
  entries=entries.map((entry,index)=>({...entry,id:String(index),ranges:ranges(entry),evidence:{source:entry.source,path:entry.doc.path,fragment:entry.target.fragment,kind:entry.source==='headings'?'inferred':'explicit'}}));
  const materializedCandidates=candidates.map((entry,index)=>({...entry,id:'candidate-'+index,ranges:ranges(entry),evidence:{source:entry.source,path:entry.doc.path,fragment:entry.target.fragment,kind:'review'}}));
  // Publishers sometimes link to plates or notes after the last TOC target.
  // Expose a whole unassigned destination under a neutral label. Do not fold
  // it into the preceding chapter or infer a chapter name from its prose.
  if(primary&&!meta.aiDirectory&&entries.length){
    const lastOrder=Math.max(...entries.map(e=>e.doc.order));
    const occupied=new Set(entries.flatMap(e=>e.ranges.map(r=>r.path)));
    const linked=new Set();
    for(const doc of documents.filter(d=>occupied.has(d.path))){
      for(const node of doc.nodes.filter(n=>local(n)==='a')){
        const target=resolveTarget(doc.path,attr(node,'href'));
        if(target&&target.path!==doc.path)linked.add(target.path);
      }
    }
    for(const doc of documents.slice(lastOrder+1)){
      if(doc.kind!=='body'||!doc.text||occupied.has(doc.path)||!linked.has(doc.path)||doc.nodes.some(n=>/^h[1-6]$/.test(local(n))))continue;
      entries.push({id:'material-'+doc.order,title:'书后材料 · '+doc.text.split('\n')[0].slice(0,70),depth:0,doc,
        ranges:[{path:doc.path,start:doc.start,end:doc.end}],evidence:{source:'spine',path:doc.path,fragment:'',kind:'linked-material'}});
    }
  }
  const selectedRanges=entries.flatMap(e=>e.ranges),uncovered=[];
  for(const doc of documents){if(doc.kind==='navigation')continue;let run=null;
    for(const atom of doc.atoms){const covered=selectedRanges.some(r=>r.path===doc.path&&r.start<=atom.start&&r.end>=atom.end);
      if(covered){if(run){uncovered.push(run);run=null;}}else if(!run){run={path:doc.path,start:atom.start,end:atom.end,kind:doc.kind};}else run.end=atom.end;
    }if(run)uncovered.push(run);
  }
  if(entries.length&&uncovered.some(r=>r.kind!=='cover'&&!documents.find(d=>d.path===r.path)?.auxiliaryOnly))warn('uncovered-content','目录未覆盖全部书内文字（可能含引言、书后材料），需要修复；原文仍保留');
  let status=entries.length?'chapters':(materializedCandidates.length?'uncertain':'not-found');
  if(entries.length===1&&!entries[0].group&&titleIdentities.has(titleIdentity(entries[0].title))&&entries[0].source!=='headings')status='single-body-entry';
  if(warnings.some(w=>['invalid-navigation','invalid-target','source-conflict','uncovered-content','navigation-source-limit'].includes(w.code)))status='uncertain';
  if(meta.aiDirectory&&entries.length&&status!=='uncertain')status='ai-generated';
  const additionalDocuments=[];
  const contentPaths=new Set([...additionalPaths,...meta.manifest.filter(item=>/html/i.test(item.mediaType)||/\.x?html?$/i.test(item.href)).map(item=>resolveTarget(meta.path,item.href)?.path).filter(Boolean)]);
  for(const path of contentPaths){
    if(documents.some(doc=>doc.path===path))continue;
    if(documents.length+additionalDocuments.length>=400)throw new Error('EPUB 阅读文件数量超过 400 个，请分册处理');
    const doc=documentAt(path);if(!doc)throw new Error('EPUB 清单中的文本文件缺失，无法确认全书完整性');
    if(doc.kind!=='navigation')doc.kind='unlisted';
    doc.id='source-'+additionalDocuments.length;additionalDocuments.push(doc);
  }
  return {meta,documents,additionalDocuments,entries,candidates:materializedCandidates,navigation:{status,source,repaired:meta.repaired,warnings,coverage:{uncovered},originalEntries:sources.flatMap(s=>s.raw.map(e=>({title:e.title,depth:e.depth,href:e.href,source:s.source}))),sourceCounts:sources.map(s=>({source:s.source,entries:s.entries.length}))}};
}

function ancestors(node){const result=[];for(let p=node.parentNode||node.parent;p;p=p.parentNode||p.parent)result.push(p);return result;}
function hasTextBetween(atoms,start,end){let lo=0,hi=atoms.length;while(lo<hi){const mid=(lo+hi)>>1;if(atoms[mid].start<start)lo=mid+1;else hi=mid;}return lo<atoms.length&&atoms[lo].start<end;}
function contentKey(doc,start){
  const atom=doc.atoms.find(item=>item.end>start);
  const image=doc.nodes.find(node=>['img','image'].includes(local(node))&&node.startIndex>=start);
  const first=Math.min(atom?Math.max(start,atom.start):doc.end,image?.startIndex??doc.end);
  return doc.path+'@'+first;
}
function ancestor(node,predicate){if(predicate(node))return node;return ancestors(node).find(predicate);}
function directoryKind(node){return attr(node,'class').match(/(?:^|\s)study-kind-(introduction|preface|part|chapter|section|author|afterword|appendix|contents|other)(?:\s|$)/)?.[1];}
function htmlLinks(root){return elements(root).filter(n=>local(n)==='a'&&attr(n,'href')).map(node=>({title:text(node),href:attr(node,'href'),kind:directoryKind(node),depth:Math.max(0,ancestors(node).filter(n=>local(n)==='ol'&&n!==root).length-1)})).filter(e=>e.title);}
function chapterNumber(title){
  const match=/^(?:chapter\s+([\w]+)(?:\b|\s|[:：.．、]|$)|第\s*([零一二三四五六七八九十百千\d]+)\s*章)/i.exec(title);
  if(!match)return null;const value=(match[1]||match[2]).toLowerCase();
  if(/^\d+$/.test(value))return Number(value);
  const words=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve'];
  if(words.includes(value))return words.indexOf(value);
  if(/^[ivxlcdm]+$/.test(value)){const values={i:1,v:5,x:10,l:50,c:100,d:500,m:1000};return [...value].reduce((sum,char,i)=>sum+(values[char]<(values[value[i+1]]||0)?-values[char]:values[char]),0);}
  const digits='零一二三四五六七八九';if([...value].every(c=>digits.includes(c)))return Number([...value].map(c=>digits.indexOf(c)).join(''));
  if(/^[一二三四五六七八九]?十[一二三四五六七八九]?$/.test(value)){const [a,b]=value.split('十');return (a?digits.indexOf(a):1)*10+(b?digits.indexOf(b):0);}
  return null;
}
function sameSplitFamily(a,b){const aa=a.match(/^(.*_split_)\d+(\.[^/.]+)$/i),bb=b.match(/^(.*_split_)\d+(\.[^/.]+)$/i);return !!aa&&!!bb&&aa[1]===bb[1]&&aa[2]===bb[2];}

module.exports={inspectNavigation};
