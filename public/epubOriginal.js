(function(root) {
  'use strict';
  const DATA_RESOURCE = /^data:(?:image\/(?:png|jpeg|jpg|gif|webp|svg\+xml)|font\/(?:woff2?|ttf|otf));base64,[A-Za-z0-9+/]+={0,2}$/;
  function normalizeOriginal(value) {
    if (value == null) return null;
    if (!value || !Array.isArray(value.chapters) || !value.chapters.length || value.chapters.length > 200) throw new Error('Invalid EPUB original chapters');
    if (JSON.stringify(value).length > 28 * 1024 * 1024) throw new Error('EPUB 原版数据超过 28 MB，请少选几章');
    const resources = Object.create(null);
    for (const [name,data] of Object.entries(value.resources || {})) {
      if (typeof data !== 'string' || !DATA_RESOURCE.test(data) || data.length > 8 * 1024 * 1024) throw new Error('Invalid EPUB original resource');
      resources[name] = data;
    }
    const chapters = value.chapters.map(chapter => {
      if (!chapter || typeof chapter.html !== 'string' || chapter.html.length > 4 * 1024 * 1024) throw new Error('Invalid EPUB original markup');
      const styles = chapter.styles || [];
      if (!Array.isArray(styles) || styles.length > 128) throw new Error('Invalid EPUB original styles');
      const bodyAttributes = {};
      const htmlAttributes = {};
      for (const name of ['class','id','lang','dir','style']) {
        if (typeof chapter.bodyAttributes?.[name] === 'string') bodyAttributes[name] = chapter.bodyAttributes[name];
        if (typeof chapter.htmlAttributes?.[name] === 'string') htmlAttributes[name] = chapter.htmlAttributes[name];
      }
      return {title:String(chapter.title || ''),html:chapter.html,baseDir:String(chapter.baseDir || ''),bodyAttributes,htmlAttributes,
        styles:styles.map(style => {
          if (!style || typeof style.css !== 'string' || style.css.length > 2 * 1024 * 1024) throw new Error('Invalid EPUB original stylesheet');
          return {css:style.css,baseDir:String(style.baseDir || '')};
        })};
    });
    return {chapters,resources};
  }
  function resolveResource(href, baseDir, resources) {
    const value = String(href || '').trim();
    if (DATA_RESOURCE.test(value)) return value;
    if (!value || /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(value)) return '';
    let decoded;
    try { decoded = decodeURIComponent(value.split(/[?#]/)[0]); } catch { return ''; }
    const parts = [];
    for (const part of (baseDir+'/'+decoded).split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') parts.pop(); else parts.push(part);
    }
    const name = parts.join('/');
    return Object.hasOwn(resources,name) && DATA_RESOURCE.test(resources[name]) ? resources[name] : '';
  }
  function rewriteCss(css, baseDir, resources) {
    // Imported book CSS has already been collected in archive order. CSP also
    // denies network stylesheet loads, including escaped or unusual CSS URLs.
    return String(css || '').replace(/@import\s+[^;]+;?/gi,'')
      .replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi, (_,a,b,c) => {
        const href = (a ?? b ?? c).trim();
        if (href.startsWith('#')) return `url("${href.replace(/["<>\\]/g,'')}")`;
        return `url("${resolveResource(href,baseDir,resources)}")`;
      });
  }
  const ALLOWED_TAGS = new Set(('a p div span section article header footer h1 h2 h3 h4 h5 h6 em i b strong blockquote br hr ul ol li dl dt dd table thead tbody tfoot tr td th caption colgroup col figure figcaption img pre code sup sub small s u mark ruby rt rp wbr svg g path circle rect line polyline polygon ellipse text tspan defs use symbol image title').split(' '));
  const DROP_TAGS = new Set(('script style head meta link base iframe frame frameset object embed form input select textarea button template noscript foreignobject audio video source track').split(' '));
  function sanitizeFragment(chapter, resources, doc) {
    // Template contents are inert: no raw book markup is ever connected before
    // cleaning, and the destination iframe cannot execute scripts.
    const template = doc.createElement('template');
    template.innerHTML = chapter.html;
    function clean(parent) {
      for (const element of [...parent.children]) {
        const tag = element.localName.toLowerCase();
        if (DROP_TAGS.has(tag)) {element.remove();continue;}
        clean(element);
        if (!ALLOWED_TAGS.has(tag)) {element.replaceWith(...element.childNodes);continue;}
        for (const attribute of [...element.attributes]) {
          const name = attribute.name.toLowerCase();
          if (/^on/.test(name) || ['srcdoc','srcset','nonce','autofocus','formaction','action','ping','target','download','is'].includes(name)) element.removeAttribute(attribute.name);
          else if (name === 'style') element.setAttribute('style',rewriteCss(attribute.value,chapter.baseDir,resources));
          else if (['src','href','xlink:href','background','poster'].includes(name)) {
            const href = attribute.value.trim();
            const internal = (tag === 'a' || tag === 'use') && /^#[^\s]*$/.test(href);
            const replacement = internal ? href : (tag === 'img' || tag === 'image') ? resolveResource(href,chapter.baseDir,resources) : '';
            if (replacement) element.setAttribute(attribute.name,replacement);else element.removeAttribute(attribute.name);
          }
        }
      }
    }
    clean(template.content);
    return template.content;
  }
  const BLOCKS = new Set(('p div h1 h2 h3 h4 h5 h6 li blockquote section article tr dt dd figcaption pre br').split(' '));
  function textLocations(body) {
    let text = '';
    const locations = [];
    function space() {if (text && !text.endsWith(' ')) {text += ' ';locations.push(null);}}
    function walk(node) {
      if (node.nodeType === 3) {
        for (let offset = 0; offset < node.data.length; offset++) {
          const char = node.data[offset];
          if (/\s/.test(char)) space();else {text += char;locations.push({node,offset});}
        }
      } else if (node.nodeType === 1) {
        const block = BLOCKS.has(node.localName.toLowerCase());
        if (block) space();
        for (const child of node.childNodes) walk(child);
        if (block) space();
      }
    }
    walk(body);
    return {text,locations};
  }
  function annotate(frames, sentences) {
    let text = ''; const locations = [], ranges = new Map();
    for (const frame of frames) {
      const content = textLocations(frame.contentDocument.body);
      text += content.text+' ';
      for (const location of content.locations) locations.push(location);
      locations.push(null);
    }
    let cursor = 0, unmatched = 0;
    sentences.forEach((sentence,index) => {
      const target = String(sentence.text || '').replace(/\s+/g,' ').trim();
      const start = target ? text.indexOf(target,cursor) : -1;
      if (start < 0) {unmatched++;return;}
      cursor = start+target.length;
      for (let at = start; at < cursor; at++) {
        const location = locations[at];
        if (!location) continue;
        const parts = ranges.get(location.node) || [];
        const last = parts.at(-1);
        if (last?.index === index) last.end = location.offset+1;
        else parts.push({index,start:location.offset,end:location.offset+1});
        ranges.set(location.node,parts);
      }
    });
    for (const [node,parts] of ranges) {
      for (const part of parts.reverse()) {
        node.splitText(part.end);
        const piece = node.splitText(part.start);
        const span = node.ownerDocument.createElement('span');
        span.className = 'study-original-sentence';span.dataset.section = String(part.index);
        span.setAttribute('role','button');span.tabIndex = 0;
        piece.replaceWith(span);span.append(piece);
      }
    }
    return unmatched;
  }
  let current = null;
  function mount({original,sections,left,right,parallel,container,bar,toggle,status,header}) {
    current?.destroy();
    container.replaceChildren();container.hidden = true;parallel.hidden = false;header.hidden = false;
    bar.hidden = !original;
    status.textContent = original ? '中英对照 · 点击英文或译文定位结构图' : '';
    toggle.textContent = '切换至 EPUB 原版';toggle.setAttribute('aria-pressed','false');
    let frames = [], observers = [], cancelled = false, mode = 'parallel', ready = null, readyStatus = '';
    function highlight(id) {
      for (const frame of frames) for (const label of frame.contentDocument?.querySelectorAll('.study-original-sentence') || []) {
        label.classList.toggle('study-selected',label.dataset.section === id);
      }
      document.dispatchEvent(new CustomEvent('study-sentence-selected',{detail:{id}}));
    }
    const navigation = root.StudyNavigation.mount(left,right,{onHighlight:highlight});
    async function createFrames() {
      const book = normalizeOriginal(original);
      for (const chapter of book.chapters) {
        if (cancelled) return;
        const frame = document.createElement('iframe');
        frame.className = 'epub-original-frame';frame.title = chapter.title || 'EPUB 原版章节';
        frame.setAttribute('sandbox','allow-same-origin');
        const loaded = new Promise((resolve,reject) => {
          const timer = setTimeout(()=>reject(new Error('原版章节加载超时，请切换回中英对照后重试')),8000);
          frame.addEventListener('load',()=>{clearTimeout(timer);resolve();},{once:true});
        });
        // No allow-scripts. CSP is installed before any book content exists.
        frame.srcdoc = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\'; img-src data:; font-src data:; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'"></head><body></body></html>';
        frames.push(frame);container.append(frame);await loaded;
        if (cancelled) return;
        const doc = frame.contentDocument;
        const style = css => {const node=doc.createElement('style');node.textContent=css;doc.head.append(node);};
        style('body{margin:18px;font:18px/1.7 Georgia,serif}');
        for (const sheet of chapter.styles) style(rewriteCss(sheet.css,sheet.baseDir,book.resources));
        style('html{overflow-x:hidden}html,body{height:auto!important;min-height:0!important}img,svg{max-width:100%}.study-original-sentence{cursor:pointer}.study-original-sentence:hover{background:#e8f2fb}.study-original-sentence.study-selected{background:#cfe8fb}.study-original-sentence:focus-visible{outline:none;text-decoration:underline;text-decoration-skip-ink:auto}');
        for (const [name,value] of Object.entries(chapter.bodyAttributes)) doc.body.setAttribute(name,name === 'style' ? rewriteCss(value,chapter.baseDir,book.resources) : value);
        for (const [name,value] of Object.entries(chapter.htmlAttributes)) doc.documentElement.setAttribute(name,name === 'style' ? rewriteCss(value,chapter.baseDir,book.resources) : value);
        for (const element of [doc.documentElement,doc.body]) {
          element.style.setProperty('height','auto','important');
          element.style.setProperty('min-height','0','important');
          element.style.setProperty('max-height','none','important');
        }
        doc.body.append(sanitizeFragment(chapter,book.resources,doc));
        const resize = () => {
          if (cancelled || !frame.isConnected || mode !== 'original') return;
          const css = doc.defaultView.getComputedStyle(doc.body);
          // The root includes collapsed heading/paragraph margins outside body.
          // Fit the complete page so the reading column owns vertical scrolling.
          const bottom = Math.max(doc.documentElement.getBoundingClientRect().bottom,
            doc.body.getBoundingClientRect().bottom+(parseFloat(css.marginBottom)||0));
          const next = Math.max(80,Math.ceil(bottom+doc.defaultView.scrollY+4));
          if (frame.style.height !== next+'px') frame.style.height = next+'px';
        };
        const observer = new ResizeObserver(resize);observer.observe(doc.body);observers.push(observer);
        doc.addEventListener('load',resize,true);
        doc.addEventListener('click',event => {
          if (event.target.closest('a')) event.preventDefault();
          if (doc.getSelection()?.toString().trim()) return;
          const label = event.target.closest('.study-original-sentence');
          if (label) {event.preventDefault();navigation.navigate(label.dataset.section);}
        });
        doc.addEventListener('keydown',event => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          const label = event.target.closest('.study-original-sentence');
          if (label) {event.preventDefault();navigation.navigate(label.dataset.section);}
        });
        frame.resizeOriginal = resize;resize();
      }
      if (cancelled) return;
      await Promise.all(frames.map(frame=>frame.contentDocument.fonts.ready));
      if (cancelled) return;
      const unmatched = annotate(frames,sections.flatMap(section=>section.sentences || []));
      // Some embedded fonts (e.g. Charis) have taller glyph boxes than the
      // publisher's fixed line-height. Span highlights then paint over the
      // previous line's descenders. Increase only affected text blocks, using
      // the loaded font's actual rectangles, without changing text or font size.
      for(const frame of frames){
        const doc=frame.contentDocument,minimums=new Map();
        for(const label of doc.querySelectorAll('.study-original-sentence')){
          const block=label.closest('p,li,dt,dd,figcaption,blockquote,h1,h2,h3,h4,h5,h6')||label.parentElement;
          const height=Math.max(0,...Array.from(label.getClientRects(),rect=>rect.height));
          minimums.set(block,Math.max(minimums.get(block)||0,Math.ceil(height)+2));
        }
        for(const [block,minimum] of minimums){
          const lineHeight=parseFloat(doc.defaultView.getComputedStyle(block).lineHeight);
          if(Number.isFinite(lineHeight)&&lineHeight<minimum)block.style.setProperty('line-height',minimum+'px','important');
        }
      }
      document.dispatchEvent(new CustomEvent('epub-original-ready',{detail:{frames}}));
      readyStatus = unmatched ? `${unmatched} 个句子未能在原版精确定位，可切回中英对照定位` : '保留书内排版 · 点击英文句子定位结构图';
      status.textContent = readyStatus;
      for (const frame of frames) frame.resizeOriginal();
      highlight(navigation.getSelectedId());
    }
    function locateSelected() {
      const id = navigation.getSelectedId();
      if (id == null) return;
      if (mode === 'original') {
        for (const frame of frames) {
          const label = frame.contentDocument?.querySelector(`.study-original-sentence[data-section="${id}"]`);
          if (!label) continue;
          const top = left.scrollTop+frame.getBoundingClientRect().top-left.getBoundingClientRect().top+label.getBoundingClientRect().top-bar.offsetHeight-20;
          left.scrollTo({top:Math.max(0,top),behavior:'instant'});break;
        }
      } else {
        const label = parallel.querySelector(`.sent-span[data-section="${id}"]`);
        if (label) {
          const top = left.scrollTop+label.getBoundingClientRect().top-left.getBoundingClientRect().top-bar.offsetHeight-header.offsetHeight-16;
          left.scrollTo({top:Math.max(0,top),behavior:'instant'});
        }
      }
    }
    async function changeMode() {
      if (!original || toggle.disabled) return;
      const chosen = navigation.getSelectedId();
      mode = mode === 'parallel' ? 'original' : 'parallel';
      parallel.hidden = mode === 'original';container.hidden = mode !== 'original';header.hidden = mode === 'original';
      toggle.textContent = mode === 'original' ? '切换至中英对照' : '切换至 EPUB 原版';toggle.setAttribute('aria-pressed',String(mode === 'original'));
      if (mode === 'original') {
        toggle.disabled = true;status.textContent = '正在还原 EPUB 排版…';
        try {ready ||= createFrames();await ready;if(!cancelled)status.textContent=readyStatus;}
        catch (error) {status.textContent=error.message;ready=null;observers.forEach(observer=>observer.disconnect());observers=[];frames=[];container.replaceChildren();}
        finally {toggle.disabled=false;}
        if (cancelled) return;
        frames.forEach(frame=>frame.resizeOriginal());
      }
      else status.textContent = '中英对照 · 点击英文或译文定位结构图';
      if (chosen != null) navigation.navigate(chosen);
      locateSelected();
    }
    toggle.addEventListener('click',changeMode);
    current = {navigate:navigation.navigate,getSelectedId:navigation.getSelectedId,showOriginal:()=>mode==='original'?ready:changeMode(),destroy(){cancelled=true;observers.forEach(observer=>observer.disconnect());toggle.removeEventListener('click',changeMode);navigation?.destroy();}};
    return current;
  }
  const api = {normalizeOriginal,resolveResource,rewriteCss,mount};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;else root.EpubOriginal = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
