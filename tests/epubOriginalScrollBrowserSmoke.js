// Isolate original-page scrolling from the thousands of diagram cards in a
// long study result. Optional argument verifies a user's existing result.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {openBrowser}=require('./browserHarness');
const {loadSavedResult}=require('../services/readerSessionRoutes');
const {sourceText}=require('../services/epubIntegrity');

async function main(){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'epub-scroll-'));
 const script=await fs.readFile(path.resolve('public/epubOriginal.js'),'utf8');
 const navigation=await fs.readFile(path.resolve('public/studyNavigation.js'),'utf8');
 const stylesheet=await fs.readFile(path.resolve('public/epubOriginal.css'),'utf8');
 let original;
 if(process.argv[2])original=(await loadSavedResult(path.dirname(path.resolve(process.argv[2])),path.basename(process.argv[2]))).original;
 else original={resources:{},chapters:[
   {title:'Opening',html:'<h1>A book opening</h1>',styles:[]},
   {title:'Long chapter',html:Array.from({length:650},(_,i)=>'<p>Paragraph '+i+'. A long chapter must remain readable through the outer reading panel.</p>').join(''),styles:[]},
   {title:'Viewport-based publisher style',html:'<p>A short final page.</p>',styles:[],
     bodyAttributes:{style:'height:100vh!important;min-height:100vh!important'},htmlAttributes:{style:'height:100%!important'}}
 ]};
 assert.ok(original?.chapters.length);
 const data=JSON.stringify(original).replace(/</g,'\\u003c');
 const html='<!doctype html><html><head><meta charset="utf-8"><style>'+stylesheet+
  'body{margin:0}#left{width:620px;height:720px;overflow:auto;display:flex;flex-direction:column;border:1px solid #ccc}#right{position:absolute;left:700px;top:0;width:300px;height:720px;overflow:auto}</style></head><body>'+
  '<div id="left"><div id="bar"><button id="toggle"></button><span id="status"></span></div><header id="header">Original</header><div id="parallel"></div><div id="original"></div></div><div id="right"></div>'+
  '<script>'+navigation+'</script><script>'+script+'</script><script>window.ready=false;const view=EpubOriginal.mount({original:'+data+
  ',sections:[],left:document.getElementById("left"),right:document.getElementById("right"),parallel:document.getElementById("parallel"),container:document.getElementById("original"),bar:document.getElementById("bar"),toggle:document.getElementById("toggle"),status:document.getElementById("status"),header:document.getElementById("header")});view.showOriginal().then(()=>window.ready=true);</script></body></html>';
 const filename=path.join(directory,'original-scroll.html');await fs.writeFile(filename,html);
 let browser;
 try{
  browser=await openBrowser();await browser.call('Network.disable');
  await browser.navigate(pathToFileURL(filename).href);
  await browser.until(()=>browser.evaluate('window.ready===true'),20000);
  const heights=[];
  for(const width of [620,400,840]){
   await browser.evaluate('document.getElementById("left").style.width='+JSON.stringify(width+'px'));
   await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
   const metrics=await browser.evaluate(`[...document.querySelectorAll('.epub-original-frame')].map(f=>({height:f.clientHeight,content:f.contentDocument.documentElement.scrollHeight,rootBottom:f.contentDocument.documentElement.getBoundingClientRect().bottom+f.contentWindow.scrollY,bodyBottom:f.contentDocument.body.getBoundingClientRect().bottom+f.contentWindow.scrollY,text:f.contentDocument.body.textContent}))`);
   console.log(JSON.stringify({width,frames:metrics.map(({height,content,rootBottom,bodyBottom})=>({height,content,rootBottom,bodyBottom}))}));
   for(const [index,frame] of metrics.entries()){
    assert.ok(frame.content<=frame.height+1,'Inner scrollbar clips chapter '+index+' at '+width+'px: '+JSON.stringify({height:frame.height,content:frame.content}));
    assert.equal(frame.text.replace(/\s/g,''),sourceText(original.chapters[index].html).replace(/\s/g,''),'Source text must be preserved');
    if(!process.argv[2]&&index===2)assert.ok(frame.height<200,'Publisher viewport styles must not cause continuous height growth');
   }
   const end=await browser.evaluate(`(()=>{const panel=document.getElementById('left'),frames=[...document.querySelectorAll('.epub-original-frame')],last=frames.at(-1);panel.scrollTop=panel.scrollHeight;const walker=last.contentDocument.createTreeWalker(last.contentDocument.body,NodeFilter.SHOW_TEXT);let node,tail;while(node=walker.nextNode())if(node.data.trim())tail=node;const range=last.contentDocument.createRange();range.setStart(tail,tail.data.length-1);range.setEnd(tail,tail.data.length);return {bottom:last.getBoundingClientRect().top+range.getBoundingClientRect().bottom,limit:panel.getBoundingClientRect().bottom};})()`);
   assert.ok(end.bottom<=end.limit+1,'The last character must be reachable using the outer panel');
   heights.push(metrics.map(frame=>frame.height));
  }
  assert.deepEqual(browser.errors,[]);
  console.log(JSON.stringify({status:'PASS',source:process.argv[2]||'synthetic long chapter',heights,offline:true}));
 }finally{await browser?.close();}
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
