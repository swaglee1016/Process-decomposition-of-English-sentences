const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const script = fs.readFileSync(path.join(__dirname, '../public/inlineDiagramCanvas.js'), 'utf8');

// Minimal DOM host for exercising the actual canvas controller's load and resize events.
function canvasHost(imageWidth, imageHeight, complete = true, reserved = {}) {
  const events = {}, imageEvents = {};
  const image = {naturalWidth:imageWidth,naturalHeight:imageHeight,complete,style:{},addEventListener:(name,fn)=>imageEvents[name]=fn};
  const label = {}, help = {};
  let clientHeight = 600;
  const style = {};
  Object.defineProperty(style,'height',{get:()=>clientHeight+'px',set:value=>{clientHeight=parseFloat(value);}});
  const root = {clientWidth:1000,get clientHeight(){return clientHeight;},set clientHeight(value){clientHeight=value;},style,isConnected:true,dataset:{...reserved},
    querySelector:selector=>({'.canvas-image':image,'.canvas-zoom':label,'.canvas-help':help})[selector],
    addEventListener:(name,fn)=>events[name]=fn,focus:()=>{}};
  let notifyResize;
  const document = {readyState:'complete',querySelectorAll:()=>[root],addEventListener:()=>{}};
  const windowEvents = {};
  const window = {innerHeight:900,addEventListener:(name,fn)=>windowEvents[name]=fn};
  vm.runInNewContext(script,{document,window,ResizeObserver:class {
    constructor(fn){notifyResize=fn;} observe(){} unobserve(){}
  }});
  return {root,image,load:()=>imageEvents.load(),
    resizeWindow(height){window.innerHeight=height;windowEvents.resize?.();},
    resize(width,height){root.clientWidth=width;root.clientHeight=height;notifyResize([{target:root}]);},
    click(action){events.click({target:{closest:()=>({dataset:{canvasAction:action}})}});}};
}
function assertContained(host) {
  const {root,image}=host;
  const zoom=Number(root.dataset.zoom),x=Number(root.dataset.panX),y=Number(root.dataset.panY);
  assert.ok(zoom>0 && zoom<=1);
  assert.ok(x>=0 && y>=0,'Initial image must not start outside the viewport');
  assert.ok(x+image.naturalWidth*zoom<=root.clientWidth+1e-6,'Entire image width must fit');
  assert.ok(y+image.naturalHeight*zoom<=root.clientHeight+1e-6,'Entire image height must fit');
}

for(const [name,w,h] of [['tall',1200,4000],['wide',5000,800],['square',2400,2400],['extremely tall',800,100000],['small',200,120]]) {
  test(`${name} diagram fits completely on first display without user zoom`,()=>assertContained(canvasHost(w,h)));
}
test('lazy-loaded images start fitted and refit when either viewport dimension changes',()=>{
  const host=canvasHost(1400,3600,false);
  assert.equal(host.root.dataset.zoom,undefined);
  host.load();assertContained(host);
  host.resize(420,300);assertContained(host);
  host.resize(1200,800);assertContained(host);
});
test('manual zoom survives resize; reset returns to automatic full-image fitting',()=>{
  const host=canvasHost(1400,3600);
  host.click('actual');assert.equal(Number(host.root.dataset.zoom),1);
  host.resize(420,300);assert.equal(Number(host.root.dataset.zoom),1);
  host.click('fit');assertContained(host);
  host.resize(1000,600);assertContained(host);
});

test('portrait diagrams receive taller canvases and larger initial text than short diagrams',()=>{
  const tall=canvasHost(1400,3600),short=canvasHost(1400,700);
  assert.ok(tall.root.clientHeight>1000,'Tall diagram should use more than the old fixed-height frame');
  assert.ok(short.root.clientHeight<600,'Short diagram should not retain unnecessary frame height');
  assert.ok(tall.root.clientHeight>short.root.clientHeight*2);
  assert.ok(Number(tall.root.dataset.zoom)>(600-24)/3600*2,'Tall diagram must become materially larger');
  assertContained(tall);assertContained(short);
});
test('very tall diagrams have bounded frames and still display the entire image',()=>{
  const host=canvasHost(800,100000);
  assert.ok(host.root.clientHeight>600&&host.root.clientHeight<=1800);
  assertContained(host);
  host.resizeWindow(500);
  assert.ok(host.root.clientHeight<=1000,'Height cap responds to smaller browser windows');
  assertContained(host);
});
test('canvas height responds to column width while zoom controls do not stretch the frame',()=>{
  const host=canvasHost(1600,1800),firstHeight=host.root.clientHeight;
  host.resize(500,firstHeight);
  assert.ok(host.root.clientHeight<firstHeight);assertContained(host);
  const height=host.root.clientHeight;
  host.click('in');host.click('actual');
  assert.equal(host.root.clientHeight,height);
});

test('distant unloaded diagrams reserve their final frame height before image decoding',()=>{
  const pending=canvasHost(0,0,false,{imageWidth:'1400',imageHeight:'3600'});
  const loaded=canvasHost(1400,3600);
  assert.equal(pending.root.clientHeight,loaded.root.clientHeight);
  assert.equal(pending.root.dataset.zoom,undefined);
  pending.image.naturalWidth=1400;pending.image.naturalHeight=3600;
  const before=pending.root.clientHeight;pending.load();
  assert.equal(pending.root.clientHeight,before,'Image decode must not shift later cards');
  assertContained(pending);
});
