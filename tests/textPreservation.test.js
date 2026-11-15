const test=require('node:test');
const assert=require('node:assert/strict');
const {parseDocument}=require('htmlparser2');
const {prepareParagraphs}=require('../services/paragraphSplitter');
const {splitText}=require('../services/textSplitter');
const {buildParallelParagraph}=require('../public/studyShared');
const compact=s=>s.replace(/\s+/g,' ').trim();
function visible(node){if(node.type==='text')return node.data;return (node.children||[]).map(visible).join('');}
function sourceColumn(node){if(node.attribs?.class==='para-text')return visible(node);return (node.children||[]).map(sourceColumn).join('');}
test('paragraph splitting and source display preserve original words even with missing or wrong sentence analyses',async()=>{
 const phrases=['FIRST naïve café.','Repeat. Repeat.','He said, “Do not omit this.”','A < B & C > D.','中文尾句。','The final line has no period'];
 for(let i=0;i<120;i++){
  const raw='  '+phrases.slice(i%phrases.length).concat(phrases.slice(0,i%phrases.length)).join(i%2?'\r\n':'\n\n')+'  ';
  for(const mode of ['preserve','pdf']){
   const result=await prepareParagraphs(raw,{mode,callModel:async()=>'{"breakAfter":[]}'});
   assert.equal(compact(result.text),compact(raw));
   const paragraphs=splitText(result.text).filter(item=>item.type==='paragraph').map(item=>item.text);
   assert.equal(compact(paragraphs.join(' ')),compact(raw));
   const rendered=paragraphs.map(paragraph=>sourceColumn(parseDocument(buildParallelParagraph({paragraph,sentences:i%2?[]:[{text:'Wrong analysis',start:999,end:1005}]})))).join(' ');
   assert.equal(compact(rendered),compact(raw));
  }
 }
});
