const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

test('a long result reserves every diagram but only initializes canvases entering the reading viewport',()=>{
 const access=[],events={},resized=new Set();let intersect;
 const roots=Array.from({length:2000},(_,index)=>{
  let height=600;
  const image={naturalWidth:1400,naturalHeight:3600,complete:true,style:{},addEventListener(){}};
  const parts={'.canvas-image':image,'.canvas-zoom':{},'.canvas-help':{}};
  const style={};Object.defineProperty(style,'height',{get:()=>height+'px',set:v=>{access.push('write');height=parseFloat(v);}});
  return {isConnected:true,style,dataset:{imageWidth:'1400',imageHeight:'3600'},
   get clientWidth(){access.push('read');return 600;},get clientHeight(){return height;},
   querySelector:s=>parts[s],addEventListener(){},focus(){}};
 });
 const document={readyState:'complete',querySelectorAll:()=>roots,addEventListener(){}};
 const window={innerHeight:900,addEventListener:(name,fn)=>events[name]=fn};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/inlineDiagramCanvas.js'),'utf8'),{
  window,document,ResizeObserver:class{observe(root){resized.add(root);}unobserve(root){resized.delete(root);}},
  IntersectionObserver:class{constructor(fn){intersect=fn;}observe(){}unobserve(){}}
 });
 assert.equal(roots.filter(r=>r.dataset.zoom).length,0,'Offscreen diagrams should not run controller layout during opening');
 assert.ok(roots.every(r=>parseFloat(r.style.height)>600),'All positions must reserve the full diagram height before a distant jump');
 assert.equal(access.indexOf('write'),2000,'Read all widths before any height writes');
 assert.ok(access.slice(2000).every(action=>action==='write'),'Reserving distant positions must not alternate layout reads and writes');
 intersect([{target:roots[0],isIntersecting:true}]);
 assert.ok(Number(roots[0].dataset.zoom)>0);
 intersect([{target:roots[0],isIntersecting:false},{target:roots[1999],isIntersecting:true}]);
 assert.ok(Number(roots[1999].dataset.zoom)>0,'The last diagram must initialize when reached');
 assert.equal(roots.filter(r=>r.dataset.zoom).length,2);
 assert.equal(resized.has(roots[0]),false,'Offscreen diagrams must stop receiving layout work');
 events.resize();
 assert.equal(roots.filter(r=>r.dataset.zoom).length,2,'Resizing the reading columns must not initialize the whole book');
});
