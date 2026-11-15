(() => {
  'use strict';
  const controllers = new WeakMap();
  const observed = new Set();
  const pending = new Map(),visible = new Set();
  let active = null;
  function deactivate() {
    if (!active) return;
    active.dataset.active = 'false';
    active.querySelector('.canvas-help').textContent = '点击后滚轮缩放 · 拖动平移';
    active = null;
  }
  function activate(root) {
    if (active !== root) deactivate();
    active = root;
    root.dataset.active = 'true';
    root.querySelector('.canvas-help').textContent = '滚轮缩放 · 拖动平移 · Esc 退出';
    root.focus({preventScroll: true});
  }
  document.addEventListener('pointerdown', event => {
    if (active && !active.contains(event.target)) deactivate();
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') deactivate(); });
  const resizeObserver = new ResizeObserver(entries => {
    for (const entry of entries) controllers.get(entry.target)?.resize();
  });
  const visibilityObserver = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    for (const entry of entries) {
      const root=entry.target;
      if (!entry.isIntersecting) {visible.delete(root);resizeObserver.unobserve(root);continue;}
      visible.add(root);
      const initialize=pending.get(root);pending.delete(root);initialize?.();
      resizeObserver.observe(root);controllers.get(root)?.resize();
    }
  },{rootMargin:'900px 0px'}) : null;
  function reserveFrames(roots) {
    // Read widths together before writing heights. Interleaving these operations
    // forces a full-document layout for every diagram in a long book.
    const sizes=roots.map(root=>({root,width:root.clientWidth,w:Number(root.dataset.imageWidth),h:Number(root.dataset.imageHeight)}));
    const maxHeight=Math.min(1800,Math.max(900,window.innerHeight*2));
    for(const {root,width,w,h} of sizes){
      if(!w||!h||width<=24)continue;
      const height=Math.ceil(Math.max(240,Math.min(maxHeight,h*Math.min(1,(width-24)/w)+26)));
      if(root.style.height!==height+'px')root.style.height=height+'px';
    }
  }
  window.addEventListener('resize', () => {
    if(visibilityObserver)reserveFrames([...observed].filter(root=>root.isConnected));
    for (const root of visibilityObserver?visible:observed) controllers.get(root)?.resize();
  });

  function mount(container = document) {
    // Release observers when another article replaces the previous result.
    for (const root of observed) {
      if (root.isConnected) continue;
      if (active === root) deactivate();
      resizeObserver.unobserve(root);visibilityObserver?.unobserve(root);
      observed.delete(root);visible.delete(root);pending.delete(root);controllers.delete(root);
    }
    const roots=[...container.querySelectorAll('.diagram-canvas')].filter(root=>!observed.has(root));
    if(visibilityObserver)reserveFrames(roots);
    for(const root of roots){
      observed.add(root);
      if(visibilityObserver){pending.set(root,()=>initialize(root));visibilityObserver.observe(root);}
      else initialize(root);
    }
    function initialize(root) {
      if (controllers.has(root)) return;
      const image = root.querySelector('.canvas-image');
      const label = root.querySelector('.canvas-zoom');
      if (!image || !label) return;
      let zoom = 1, x = 0, y = 0, ready = false, mode = 'fit', drag = null;
      let width = root.clientWidth, height = root.clientHeight;
      function sizeFrame() {
        const sourceWidth = image.naturalWidth || Number(root.dataset.imageWidth);
        const sourceHeight = image.naturalHeight || Number(root.dataset.imageHeight);
        if (!sourceWidth || !sourceHeight || width <= 24) return;
        // Fit to the available width, giving portrait diagrams room to be read.
        // Bound extreme diagrams to roughly two screens, never beyond 1800px.
        const maxHeight = Math.min(1800, Math.max(900, window.innerHeight * 2));
        const widthScale = Math.min(1, (width - 24) / sourceWidth);
        const target = Math.ceil(Math.max(240, Math.min(maxHeight, sourceHeight * widthScale + 26)));
        if (root.style.height !== target + 'px') root.style.height = target + 'px';
        height = root.clientHeight;
      }
      function visibleBounds() {
        const full = {left:0,top:0,width,height};
        if (!root.getBoundingClientRect) return full;
        const rect = root.getBoundingClientRect();
        const originX = rect.left + (root.clientLeft || 0), originY = rect.top + (root.clientTop || 0);
        let left = Math.max(originX,0), top = Math.max(originY,0);
        let right = Math.min(originX+width,window.innerWidth), bottom = Math.min(originY+height,window.innerHeight);
        for (let parent=root.parentElement;parent;parent=parent.parentElement) {
          const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
          if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {left=Math.max(left,bounds.left);right=Math.min(right,bounds.right);}
          if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
            const header=parent.querySelector(':scope > .panel-header');
            const headerBottom=header&&getComputedStyle(header).position==='sticky'?header.getBoundingClientRect().bottom:bounds.top;
            top=Math.max(top,bounds.top,headerBottom);bottom=Math.min(bottom,bounds.bottom);
          }
        }
        return right>left&&bottom>top ? {left:left-originX,top:top-originY,width:right-left,height:bottom-top} : full;
      }
      function paint() {
        if (!ready) return;
        const imageWidth = image.naturalWidth * zoom, imageHeight = image.naturalHeight * zoom;
        const bounds = mode==='manual' ? visibleBounds() : {left:0,top:0,width,height};
        const limit = (value, start, space, size) => Math.max(Math.min(start+12, start+space-size-12), Math.min(Math.max(start+12, start+space-size-12), value));
        x = limit(x, bounds.left, bounds.width, imageWidth); y = limit(y, bounds.top, bounds.height, imageHeight);
        image.style.width = image.naturalWidth + 'px';
        image.style.height = image.naturalHeight + 'px';
        image.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
        label.textContent = Math.round(zoom * 100) + '%';
        root.dataset.zoom = String(zoom);
        root.dataset.panX = String(x); root.dataset.panY = String(y);
      }
      function layout(kind) {
        sizeFrame();
        if (!image.naturalWidth || width <= 24 || height <= 24) return;
        ready = true; mode = kind;
        const fit = Math.min((width - 24) / image.naturalWidth, (height - 24) / image.naturalHeight, 1);
        zoom = fit;
        x = image.naturalWidth * zoom > width ? 12 : (width - image.naturalWidth * zoom) / 2;
        y = (height - image.naturalHeight * zoom) / 2;
        paint();
      }
      function setZoom(next, anchor) {
        if (!ready) return;
        if (!anchor) {const bounds=visibleBounds();anchor={x:bounds.left+bounds.width/2,y:bounds.top+bounds.height/2};}
        const value = Math.max(.01, Math.min(8, next));
        x = anchor.x - (anchor.x - x) * value / zoom;
        y = anchor.y - (anchor.y - y) * value / zoom;
        zoom = value; mode = 'manual'; paint();
      }
      controllers.set(root, {resize() {
        const previousWidth = width, previousHeight = height;
        width = root.clientWidth; sizeFrame();
        if (mode === 'manual') { x += (width - previousWidth) / 2; y += (height - previousHeight) / 2; }
        if (mode === 'manual') paint(); else layout(mode);
      }});
      resizeObserver.observe(root);
      observed.add(root);
      sizeFrame();
      image.addEventListener('load', () => layout('fit'));
      image.addEventListener('error', () => { root.querySelector('.canvas-help').textContent = '图片加载失败'; });
      if (image.complete && image.naturalWidth) layout('fit');
      root.addEventListener('click', event => {
        const button = event.target.closest('[data-canvas-action]');
        if (!button) return;
        activate(root);
        const action = button.dataset.canvasAction;
        if (action === 'fit') layout('fit');
        else if (action === 'actual') setZoom(1);
        else setZoom(zoom * (action === 'in' ? 1.25 : .8));
      });
      root.addEventListener('wheel', event => {
        if (active !== root && !event.ctrlKey && !event.metaKey) return;
        activate(root); event.preventDefault(); event.stopPropagation();
        const rect = root.getBoundingClientRect();
        setZoom(zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12), {x: event.clientX - rect.left, y: event.clientY - rect.top});
      }, {passive: false});
      root.addEventListener('pointerdown', event => {
        if (event.button !== 0 || event.target.closest('button')) return;
        activate(root); event.preventDefault();
        drag = {id: event.pointerId, x: event.clientX, y: event.clientY, startX: x, startY: y};
        root.setPointerCapture(event.pointerId); root.classList.add('is-dragging');
      });
      root.addEventListener('pointermove', event => {
        if (!drag || drag.id !== event.pointerId) return;
        x = drag.startX + event.clientX - drag.x; y = drag.startY + event.clientY - drag.y;
        mode = 'manual'; paint();
      });
      function stopDrag() { drag = null; root.classList.remove('is-dragging'); }
      root.addEventListener('pointerup', stopDrag);
      root.addEventListener('pointercancel', stopDrag);
      root.addEventListener('lostpointercapture', stopDrag);
      root.addEventListener('keydown', event => {
        if (event.target.closest('button')) return;
        if (event.key === '+' || event.key === '=') { activate(root); setZoom(zoom * 1.25); }
        else if (event.key === '-') { activate(root); setZoom(zoom * .8); }
        else if (event.key === '0') { activate(root); layout('fit'); }
        else return;
        event.preventDefault();
      });
    }
  }
  window.InlineDiagramCanvas = {mount};
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mount());
  else mount();
})();
