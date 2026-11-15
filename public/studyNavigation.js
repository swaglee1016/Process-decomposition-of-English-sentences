(() => {
  'use strict';
  let current = null;
  function mount(left, right, options = {}) {
    current?.destroy();
    if (!left || !right) return;
    const cards = [...right.querySelectorAll('.sent-card[data-section]')];
    const byId = new Map(cards.map(card => [card.dataset.section,card]));
    const labels = [...left.querySelectorAll('.sent-span,.translation-text')];
    const content = right.querySelector('#rightContent') || right;
    let anchor = null, frame = 0, selectedId = null;
    const listeners = [];
    function on(element, name, handler, options) { element.addEventListener(name,handler,options); listeners.push(()=>element.removeEventListener(name,handler,options)); }
    function highlight(id) {
      selectedId = id;
      labels.forEach(label => {
        const selected = label.dataset.section === id;
        label.classList.toggle('highlight', selected);
        if (selected) label.setAttribute('aria-current','true'); else label.removeAttribute('aria-current');
      });
      options.onHighlight?.(id);
    }
    function align() {
      frame = 0;
      if (!anchor?.isConnected) return;
      const overflow = getComputedStyle(right).overflowY;
      if (overflow === 'visible') {
        anchor.scrollIntoView({block:'start',behavior:'instant'});
        return;
      }
      const headerHeight = right.querySelector('.panel-header')?.offsetHeight || 0;
      const top = right.scrollTop + anchor.getBoundingClientRect().top - right.getBoundingClientRect().top - headerHeight - 12;
      if (Math.abs(right.scrollTop - Math.max(0,top)) > 1) right.scrollTo({top:Math.max(0,top),behavior:'instant'});
    }
    function schedule() { if (anchor && !frame) frame = requestAnimationFrame(align); }
    function release() { anchor = null; if (frame) cancelAnimationFrame(frame); frame = 0; }
    function navigate(id) {
      const card = byId.get(id);
      if (!card) return;
      release(); anchor = card; highlight(id);
      // Decode the chosen image promptly; preceding frames already reserve their
      // intrinsic aspect ratio, so they cannot move the distant destination.
      for (const image of card.querySelectorAll('img')) image.loading = 'eager';
      align(); schedule();
    }
    function select(event) {
      if (event.type === 'click' && left.ownerDocument?.getSelection()?.toString().trim()) return;
      const label = event.target.closest('.sent-span,.translation-text');
      if (!label || !left.contains(label)) return;
      if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault(); navigate(label.dataset.section);
    }
    on(left,'click',select); on(left,'keydown',select);
    on(right,'wheel',release,{passive:true}); on(right,'pointerdown',release); on(right,'touchstart',release,{passive:true});
    on(right,'keydown',event => { if (['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key)) release(); });
    // Page-level scrolling is used on narrow screens.
    on(window,'wheel',event => { if (!left.contains(event.target) && !right.contains(event.target)) release(); },{passive:true});
    on(right,'load',schedule,true); on(window,'resize',schedule);
    const resize = new ResizeObserver(schedule); resize.observe(content);
    const visible = new Set();
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => { if (entry.isIntersecting) visible.add(entry.target); else visible.delete(entry.target); });
      if (anchor) return;
      const top = right.getBoundingClientRect().top + (right.querySelector('.panel-header')?.offsetHeight || 0);
      const nearest = [...visible].sort((a,b)=>Math.abs(a.getBoundingClientRect().top-top)-Math.abs(b.getBoundingClientRect().top-top))[0];
      if (nearest) highlight(nearest.dataset.section);
    },{root:right,threshold:[0,.1,.5]});
    cards.forEach(card=>observer.observe(card));
    current = {navigate,getSelectedId:()=>selectedId,destroy() {release();resize.disconnect();observer.disconnect();listeners.forEach(remove=>remove());}};
    return current;
  }
  window.StudyNavigation = {mount};
})();
