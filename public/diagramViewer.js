(() => {
  'use strict';
  const viewport = document.getElementById('diagramViewport');
  const image = document.getElementById('diagramImage');
  const stage = document.getElementById('diagramStage');
  const label = document.getElementById('zoomLabel');
  if (!viewport || !image || !stage) return;
  let zoom = 1;
  let drag = null;
  function setZoom(value, anchor) {
    const previous = zoom;
    zoom = Math.min(8, Math.max(0.05, value));
    const point = anchor || {x: viewport.clientWidth / 2, y: viewport.clientHeight / 2};
    const left = (viewport.scrollLeft + point.x) / previous;
    const top = (viewport.scrollTop + point.y) / previous;
    image.style.width = Math.max(1, image.naturalWidth * zoom) + 'px';
    image.style.height = Math.max(1, image.naturalHeight * zoom) + 'px';
    stage.style.width = Math.max(viewport.clientWidth, image.naturalWidth * zoom + 32) + 'px';
    stage.style.height = Math.max(viewport.clientHeight, image.naturalHeight * zoom + 32) + 'px';
    viewport.scrollLeft = left * zoom - point.x;
    viewport.scrollTop = top * zoom - point.y;
    label.textContent = Math.round(zoom * 100) + '%';
  }
  function fit() {
    if (!image.naturalWidth || !image.naturalHeight) return;
    setZoom(Math.min((viewport.clientWidth - 32) / image.naturalWidth, (viewport.clientHeight - 32) / image.naturalHeight, 1));
    viewport.scrollTo(0, 0);
  }
  document.getElementById('zoomIn').addEventListener('click', () => setZoom(zoom * 1.25));
  document.getElementById('zoomOut').addEventListener('click', () => setZoom(zoom / 1.25));
  document.getElementById('zoomActual').addEventListener('click', () => setZoom(1));
  document.getElementById('zoomFit').addEventListener('click', fit);
  viewport.addEventListener('wheel', event => {
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    setZoom(zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12), {x:event.clientX - rect.left, y:event.clientY - rect.top});
  }, {passive:false});
  viewport.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    drag = {x:event.clientX, y:event.clientY, left:viewport.scrollLeft, top:viewport.scrollTop};
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add('dragging');
    event.preventDefault();
  });
  viewport.addEventListener('pointermove', event => {
    if (!drag) return;
    viewport.scrollLeft = drag.left + drag.x - event.clientX;
    viewport.scrollTop = drag.top + drag.y - event.clientY;
  });
  function stopDrag() { drag = null; viewport.classList.remove('dragging'); }
  viewport.addEventListener('pointerup', stopDrag);
  viewport.addEventListener('pointercancel', stopDrag);
  viewport.addEventListener('lostpointercapture', stopDrag);
  viewport.addEventListener('keydown', event => {
    if (event.key === '+' || event.key === '=') setZoom(zoom * 1.25);
    else if (event.key === '-') setZoom(zoom / 1.25);
    else if (event.key === '0') fit();
    else return;
    event.preventDefault();
  });
  image.addEventListener('load', fit);
  image.addEventListener('error', () => { label.textContent = '图片加载失败'; });
  window.addEventListener('resize', fit);
  if (image.complete) fit();
})();
