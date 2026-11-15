const {parseDocument} = require('htmlparser2');
const normalize=value=>String(value).replace(/\s+/g,' ').trim();
const blocks=new Set('body p div h1 h2 h3 h4 h5 h6 li blockquote section article tr td th dt dd figcaption pre br img image'.split(' '));

// Build a fresh text baseline by traversing source markup. This does not use
// chapter offsets or the application's regex-based text extraction.
function sourceText(html){
  const root=parseDocument(html);
  function visit(node){
    if(node.type==='text')return node.data;
    if(['head','style','script'].includes(node.name))return '';
    const contents=(node.children||[]).map(visit).join('');
    return blocks.has(node.name)?' '+contents+' ':contents;
  }
  return normalize(visit(root));
}
function checkBookIntegrity(sourceByPath,readingItems,chapters){
  for(const source of sourceByPath.values()){
    const item=readingItems.find(item=>item.path===source.path);
    if(!item||sourceText(source.html)!==normalize(item.text))throw new Error('EPUB 全书文字校验失败，源文件文字未完整进入阅读内容：'+source.path);
  }
  for(const chapter of chapters){
    const expected=chapter.ranges.map(range=>{
      const source=sourceByPath.get(range.path);
      return sourceText(source.html.slice(range.start,range.end));
    }).join(' ');
    if(normalize(expected)!==normalize(chapter.text))throw new Error('EPUB 章节文字校验失败，已停止显示不完整章节');
  }
  return {status:'verified',files:sourceByPath.size,characters:readingItems.reduce((sum,item)=>sum+item.text.length,0)};
}
module.exports={checkBookIntegrity,sourceText};
