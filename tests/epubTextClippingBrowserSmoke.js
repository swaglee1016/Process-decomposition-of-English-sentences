// Tests actual glyph preservation while highlighting a tight-line-height EPUB.
// Optional input is an existing saved result; only a new copy is written.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {openBrowser}=require('./browserHarness');
async function main(){
 const source=path.resolve(process.argv[2]||'outputs/sentence-decomposition-20261029-215820.html');
 const html=await fs.readFile(source,'utf8'),runtime=await fs.readFile(path.resolve(__dirname,'../public/epubOriginal.js'),'utf8');
 let changed=0;
 const patched=html.replace(/<script>([\s\S]*?)<\/script>/g,(whole,code)=>{if(!code.includes('const DATA_RESOURCE =')||!code.includes('root.EpubOriginal'))return whole;changed++;return '<script>'+runtime+'</script>';});
 assert.equal(changed,1);
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'epub-glyph-preservation-'));
 const file=path.join(folder,'fixed.html');await fs.writeFile(file,patched);
 let browser;
 try{
  browser=await openBrowser();const {evaluate,until}=browser;
  await browser.navigate(pathToFileURL(file).href);
  await until(()=>evaluate('!!document.querySelector(".epub-original-frame")?.contentDocument?.querySelector(".study-original-sentence")'));
  await evaluate('Promise.all([...document.querySelectorAll(".epub-original-frame")].map(f=>f.contentDocument.fonts.ready))');
  const info=await evaluate(`(()=>{const f=document.querySelector('.epub-original-frame'),d=f.contentDocument;const target=[...d.querySelectorAll('.study-original-sentence')].find(s=>s.textContent.startsWith('To see how alien'));if(!target)throw Error('Target missing');window.glyphTarget=target;window.glyphFrame=f;document.querySelector('.panel-left').scrollTop+=f.getBoundingClientRect().top+target.getBoundingClientRect().top-250;d.querySelectorAll('.study-selected').forEach(s=>s.classList.remove('study-selected'));d.activeElement.blur();d.defaultView.CSS.highlights?.clear();const r=target.parentElement.getBoundingClientRect(),fr=f.getBoundingClientRect(),css=d.defaultView.getComputedStyle(target);return {clip:{x:Math.max(0,fr.x+r.x),y:Math.max(0,fr.y+r.y),width:r.width,height:r.height,scale:1},lineHeight:css.lineHeight,font:css.fontFamily,text:target.parentElement.textContent};})()`);
  await browser.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0});
  const before=await browser.call('Page.captureScreenshot',{format:'png',clip:info.clip});
  await evaluate(`(()=>{const s=glyphTarget;document.querySelector('#translationContent .translation-text[data-section="'+s.dataset.section+'"]').click();document.querySelector('.panel-left').scrollTop+=glyphFrame.getBoundingClientRect().top+s.parentElement.getBoundingClientRect().top-${info.clip.y};})()`);
  const after=await browser.call('Page.captureScreenshot',{format:'png',clip:info.clip});
  const pixels=await evaluate(`(async()=>{async function read(b){const image=new Image();image.src='data:image/png;base64,'+b;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const c=canvas.getContext('2d');c.drawImage(image,0,0);return c.getImageData(0,0,image.width,image.height).data;}const a=await read(${JSON.stringify(before.data)}),b=await read(${JSON.stringify(after.data)});let dark=0,lost=0;for(let i=0;i<a.length;i+=4){if(a[i]<70&&a[i+1]<70&&a[i+2]<70){dark++;if(b[i]>120||b[i+1]>120||b[i+2]>120)lost++;}}return {dark,lost};})()`);
  await fs.writeFile(path.join(folder,'before.png'),Buffer.from(before.data,'base64'));await fs.writeFile(path.join(folder,'selected.png'),Buffer.from(after.data,'base64'));
  console.log(JSON.stringify({folder,file,font:info.font,lineHeight:info.lineHeight,...pixels}));
  assert.ok(pixels.dark>100,'must measure real text glyphs');
  assert.ok(pixels.lost<=5,`selection erased ${pixels.lost} dark glyph pixels`);
  assert.equal(await evaluate('glyphTarget.parentElement.textContent'),info.text);
  assert.deepEqual(browser.errors,[]);
 }finally{await browser?.close();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
