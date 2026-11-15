// Synthetic application acceptance; retains outputs and temporary database.
const assert=require('node:assert/strict');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');const {pathToFileURL}=require('node:url');
const {createApp}=require('../server');const {openBrowser}=require('./browserHarness');
async function main(){
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'vocabulary-browser-'));const outputDir=path.resolve(__dirname,'../outputs');
 const options={outputDir,vocabularyPath:path.join(temp,'vocabulary.sqlite'),delayMs:0,dictionaryLookup:async word=>({dictionary:{word,provider:'deepseek',pronunciationVersion:1,relationsVersion:1,relations:{synonyms:[],antonyms:[],relatedWords:[]},dialect:'en-US',phonetics:[{text:'/reɪn/'}],meanings:[{partOfSpeech:'noun',americanPhonetic:'/reɪn/',definitions:[{definition:'Water falling from clouds.',example:'Rain fell.'}]},{partOfSpeech:'verb',americanPhonetic:'/reɪn/',definitions:[{definition:'To fall as water drops.'}]}],sources:[]},audioDataUri:null,error:''}),analyzeSentence:async text=>({sentenceType:'简单句',translation:'验收译文',parts:[{text,role:'主句',translation:'验收译文'}]}),renderDiagram:async()=>null};
 let dictionaryCalls=0;const lookup=options.dictionaryLookup;options.dictionaryLookup=async word=>{dictionaryCalls++;return lookup(word);};
 let app=createApp(options),server=app.listen(0,'127.0.0.1'),browser;await new Promise(r=>server.once('listening',r));const port=server.address().port;
 const stop=async()=>{if(server.listening){server.closeAllConnections();await new Promise(r=>server.close(r));}app.locals.closeVocabulary();};
 try{
  browser=await openBrowser();await browser.call('Page.addScriptToEvaluateOnNewDocument',{source:'window.open=()=>null'});const {evaluate,until}=browser;await browser.navigate('http://127.0.0.1:'+port);
  async function verifyBackdropDismiss(){
   const inside=await evaluate('(()=>{const r=document.getElementById("vocabularySearch").getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()');
   async function click(point){await browser.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await browser.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});}
   await click(inside);assert.equal(await evaluate('document.getElementById("vocabularyDialog").open'),true,'inside interaction must leave the dialog open');
   const outside=await evaluate('(()=>{const r=document.getElementById("vocabularyDialog").getBoundingClientRect();return {x:r.right+12<innerWidth?r.right+12:r.left-12,y:r.top+r.height/2};})()');
   await click(outside);assert.equal(await evaluate('document.getElementById("vocabularyDialog").open'),false,'clicking blank backdrop must dismiss the dialog');
   await evaluate('document.getElementById("vocabularyButton").click()');assert.equal(await evaluate('document.getElementById("vocabularyDialog").open'),true);
  }
  await until(()=>evaluate('typeof renderSections === "function"'));
  assert.equal(await evaluate('!!document.getElementById("vocabularyButton")'),true);
  const original={chapters:[{id:'a',title:'Rain',html:'<html><body><p>Rain fell. A fell<em>ow</em> waited.</p></body></html>',styles:[]}]};
  await evaluate(`sectionsData=[{paragraph:'Rain fell. A fellow waited.',sentences:[{text:'Rain fell.',start:0,end:10,html:'<p class="sentence-caption">Rain fell.</p>'},{text:'A fellow waited.',start:11,end:27,html:'<p class="sentence-caption">A fellow waited.</p>'}]}];renderSections();`);
  async function selectRain(doc='document',word='Rain'){
   await evaluate('if(document.getElementById("vocabularyDialog").open)document.getElementById("vocabularyClose").click()');
   await evaluate(`(()=>{const d=${doc},root=d===document?d.querySelector('.para-text'):d.querySelector('p');const walk=d.createTreeWalker(root,4);let n;while(n=walk.nextNode()){const i=n.textContent.indexOf(${JSON.stringify(word)});if(i>=0){const range=d.createRange();range.setStart(n,i);range.setEnd(n,i+${word.length});const selection=d.getSelection();selection.removeAllRanges();selection.addRange(range);root.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));break;}}})()`);
   await until(()=>evaluate('document.getElementById("vocabularyDialog").open'));
  }
  await selectRain('document','waited');await until(()=>evaluate('document.getElementById("vocabularyDetail").textContent.includes("Water falling")'));
  assert.equal(await evaluate('document.getElementById("vocabularyButton").textContent'),'生词库 · 0');
  assert.equal(await evaluate('document.getElementById("vocabularyDetailAdd")?.textContent'),'加入生词库');
  const callsBeforeAdd=dictionaryCalls;await evaluate('document.getElementById("vocabularyDetailAdd").click()');
  await until(()=>evaluate('document.querySelector(".vocabulary-list [data-word=waited]") && document.querySelector(".vocabulary-word[data-word=waited]")'));
  await until(()=>evaluate('document.getElementById("vocabularyDetail").textContent.includes("Water falling")'));
  assert.equal(dictionaryCalls,callsBeforeAdd,'adding an explained word must reuse its cached explanation');
  await evaluate('[...document.querySelectorAll("#vocabularyDetail button")].find(button=>button.textContent==="移出生词库").click()');
  await until(()=>evaluate('document.getElementById("vocabularyButton").textContent==="生词库 · 0"'));
  await evaluate('document.getElementById("vocabularyClose").click()');
  await selectRain();await evaluate('document.getElementById("vocabularyDetailAdd").click()');
  await until(()=>evaluate('document.querySelectorAll(".vocabulary-word").length===1'));
  await until(()=>evaluate('document.getElementById("vocabularyUndo") && !document.getElementById("vocabularyUndo").disabled'));
  await evaluate('document.getElementById("vocabularyUndo").click()');await until(()=>evaluate('document.querySelectorAll(".vocabulary-word").length===0'));
  await selectRain();await evaluate('document.getElementById("vocabularyDetailAdd").click()');
  await until(()=>evaluate('document.querySelectorAll(".vocabulary-word").length===1'));
  await evaluate('document.getElementById("vocabularyButton").click()');await until(()=>evaluate('document.querySelector(".vocabulary-list button")'));
  await evaluate('document.querySelector(".vocabulary-list button").click()');await until(()=>evaluate('document.getElementById("vocabularyDetail").textContent.includes("Water falling")'));
  const detail=await evaluate('document.getElementById("vocabularyDetail").textContent');assert.match(detail,/noun/);assert.match(detail,/verb/);assert.match(detail,/美式音标：\/reɪn\//);assert.doesNotMatch(detail,/发音使用浏览器/);
  await evaluate(`Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>[{lang:'en-GB',name:'British'},{lang:'en-US',name:'American'}],cancel(){},speak(utterance){window.acceptanceVoice={lang:utterance.lang,name:utterance.voice.name,text:utterance.text};}}});Object.defineProperty(window,'SpeechSynthesisUtterance',{configurable:true,value:class{constructor(text){this.text=text;}}});[...document.querySelectorAll('#vocabularyDetail button')].find(button=>button.textContent==='美式朗读').click();`);
  assert.deepEqual(await evaluate('window.acceptanceVoice'),{lang:'en-US',name:'American',text:'rain'});
  await verifyBackdropDismiss();
  await evaluate('document.getElementById("vocabularyClose").click()');
  await selectRain();
  assert.equal(await evaluate(`(()=>{const selected=document.querySelector('.sent-span.highlight')?.dataset.section;document.querySelector('.sent-span[data-section="0"]').click();return document.querySelector('.sent-span.highlight')?.dataset.section===selected;})()`),true,'selection must not change sentence navigation');
  await evaluate(`document.getElementById('vocabularyClose').click();document.getSelection().removeAllRanges();resultOriginal=${JSON.stringify(original)};renderSections()`);
  await until(()=>evaluate('document.querySelector(".epub-original-frame")?.contentDocument.querySelector(".study-original-sentence")'));
  const point=await evaluate(`(()=>{const frame=document.querySelector('.epub-original-frame'),d=frame.contentDocument,walk=d.createTreeWalker(d.querySelector('p'),4);let node;while(node=walk.nextNode())if(node.textContent.includes('Rain'))break;frame.scrollIntoView({block:'start'});const range=d.createRange();range.setStart(node,node.textContent.indexOf('Rain'));range.setEnd(node,node.textContent.indexOf('Rain')+4);const r=range.getBoundingClientRect(),f=frame.getBoundingClientRect();return {x:f.left+r.left+r.width/2,y:f.top+r.top+r.height/2};})()`);
  await browser.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:2,...point});await browser.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:2,...point});
  assert.equal(await evaluate('document.querySelector(".epub-original-frame").contentDocument.getSelection().toString().trim()'),'Rain');
  await until(()=>evaluate('document.getElementById("vocabularyDialog").open'));
  await selectRain('document.querySelector(".epub-original-frame").contentDocument');
  await evaluate('[...document.querySelectorAll("#vocabularyDetail button")].find(b=>b.textContent==="移出生词库").click()');await until(()=>evaluate('document.querySelector(".epub-original-frame").contentDocument.querySelectorAll(".vocabulary-word").length===0'));
  await selectRain('document.querySelector(".epub-original-frame").contentDocument');await evaluate('document.getElementById("vocabularyDetailAdd").click()');await until(()=>evaluate('document.querySelector(".epub-original-frame").contentDocument.querySelectorAll(".vocabulary-word").length===1'));
  assert.equal(await evaluate('document.querySelector(".epub-original-frame").contentDocument.querySelectorAll(".vocabulary-word").length'),1);
  await selectRain('document.querySelector(".epub-original-frame").contentDocument','fell');await evaluate('document.getElementById("vocabularyDetailAdd").click()');
  await until(()=>evaluate('document.querySelector(".epub-original-frame").contentDocument.querySelectorAll(".vocabulary-word").length===2'));
  assert.equal(await evaluate('document.querySelector(".epub-original-frame").contentDocument.querySelectorAll("[data-word=fellow]").length'),0);
  await evaluate('document.getElementById("vocabularyUndo").click()');await until(()=>evaluate('document.querySelector(".epub-original-frame").contentDocument.querySelectorAll(".vocabulary-word").length===1'));
  await evaluate('document.querySelector(".epub-original-frame").contentDocument.getSelection().removeAllRanges()');
  // Related spellings use the same collected entry, including the EPUB reader.
  await evaluate('textInput.value="Incantation incantations incantational.";processBtn.click()');await until(()=>evaluate('!!preview && !busy'));await evaluate('analyzeBtn.click()');await until(()=>evaluate('!busy && statusText.textContent.startsWith("完成：")'));
  await selectRain('document','Incantation');await evaluate('document.getElementById("vocabularyDetailAdd").click()');await until(()=>evaluate('document.querySelectorAll(".vocabulary-word[data-word=incantation]").length===2'));
  await evaluate('resultOriginal={chapters:[{title:"Word forms",html:"<p>Incantation incanta<em>tions</em> incantational.</p>",styles:[]}]};renderSections()');await until(()=>evaluate('document.querySelector(".epub-original-frame")?.contentDocument.querySelector(".vocabulary-word")'));
  assert.equal(await evaluate('[...document.querySelector(".epub-original-frame").contentDocument.querySelectorAll(".vocabulary-word")].map(node=>node.textContent).join(" ")'),'Incantation incanta tions');
  await evaluate('resultOriginal=null;renderSections()');await selectRain('document','incantations');
  assert.equal(await evaluate('[...document.querySelectorAll("#vocabularyDetail button")].some(b=>b.textContent==="移出生词库")'),true);await until(()=>evaluate('document.querySelector("#vocabularyDetail h3").textContent==="incantation"'));
  await evaluate('[...document.querySelectorAll("#vocabularyDetail button")].find(button=>button.textContent==="移出生词库").click()');await until(()=>evaluate('document.querySelectorAll(".vocabulary-word[data-word=incantation]").length===0'));await evaluate('document.getElementById("vocabularyClose").click()');
  // Generate through the real application path, then read the persisted output.
  await evaluate('textInput.value="Rain fell. It rains.";processBtn.click()');await until(()=>evaluate('!!preview && !busy'));
  await evaluate('analyzeBtn.click()');await until(()=>evaluate('!busy && statusText.textContent.startsWith("完成：")'));
  assert.equal(await evaluate('document.querySelectorAll(".vocabulary-word").length'),2);
  const filename=await evaluate('savePath.textContent.replace("已永久保存：outputs/","")');const saved=path.join(outputDir,filename);
  await stop();const before=browser.requests.length;await browser.navigate(pathToFileURL(saved).href);
  await until(()=>evaluate('!!document.getElementById("vocabularyButton") && document.querySelectorAll(".vocabulary-word").length===2'));
  await evaluate('document.getElementById("vocabularyButton").click();document.querySelector(".vocabulary-list button").click()');
  await until(()=>evaluate('document.getElementById("vocabularyDetail").textContent.includes("Water falling")'));
  assert.equal(browser.requests.slice(before).some(url=>/^https?:/.test(url)),false);
  await verifyBackdropDismiss();
  app=createApp(options);server=app.listen(port,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  await evaluate('document.getElementById("vocabularySync").click()');await until(()=>evaluate('document.getElementById("vocabularyStatus").textContent.includes("已连接")'));
  assert.equal(browser.errors.length,0);console.log('Vocabulary browser acceptance passed: selection, undo, dictionary, future highlighting, offline snapshot and restart synchronization.');
 }finally{await browser?.close();await stop();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
