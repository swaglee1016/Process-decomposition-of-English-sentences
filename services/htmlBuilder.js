/**
 * HTML 组装 — 迁移自 n8n "Init HTML" / "1. 组装段落 HTML" / "3. 组装图片 HTML" / "Download HTML" 节点
 */

const fs = require('node:fs');
const path = require('node:path');
const { buildParallelParagraph } = require('../public/studyShared');
const viewerScript = fs.readFileSync(path.join(__dirname, '../public/diagramViewer.js'), 'utf8');
const canvasScript = fs.readFileSync(path.join(__dirname, '../public/inlineDiagramCanvas.js'), 'utf8');
const canvasStyle = fs.readFileSync(path.join(__dirname, '../public/inlineDiagramCanvas.css'), 'utf8');
const readingStyle = fs.readFileSync(path.join(__dirname, '../public/parallelReading.css'), 'utf8');
const navigationScript = fs.readFileSync(path.join(__dirname, '../public/studyNavigation.js'), 'utf8');
const originalScript = fs.readFileSync(path.join(__dirname, '../public/epubOriginal.js'), 'utf8');
const originalStyle = fs.readFileSync(path.join(__dirname, '../public/epubOriginal.css'), 'utf8');
const vocabularyScript = fs.readFileSync(path.join(__dirname, '../public/vocabulary.js'), 'utf8');
const vocabularySharedScript = fs.readFileSync(path.join(__dirname, '../public/vocabularyShared.js'), 'utf8');
const vocabularyStyle = fs.readFileSync(path.join(__dirname, '../public/vocabulary.css'), 'utf8');
const workspaceScript = fs.readFileSync(path.join(__dirname, '../public/readingWorkspace.js'), 'utf8');
const workspaceStyle = fs.readFileSync(path.join(__dirname, '../public/readingWorkspace.css'), 'utf8');
const { normalizeOriginal } = require('../public/epubOriginal');

function imageSource(base64, mimeType) {
  if (!['image/png', 'image/svg+xml'].includes(mimeType) || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new TypeError('Unsupported diagram image');
  }
  return `data:${mimeType};base64,${base64}`;
}

function buildDiagramPage(sentence, base64, mimeType) {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>句子结构图 · 独立查看</title>
<style>*{box-sizing:border-box}body{margin:0;font-family:system-ui,sans-serif;background:#eef2f6;color:#25364a;display:flex;flex-direction:column;height:100vh}header{padding:12px 18px;background:white;border-bottom:1px solid #dbe3ea}nav{display:flex;align-items:center;flex-wrap:wrap;gap:8px}button{padding:8px 14px;border:1px solid #bac9d8;border-radius:6px;background:white;cursor:pointer;font-size:14px}button:hover{background:#e8f2fb}button:focus-visible{outline:3px solid #3498db}details{margin-top:10px;font-size:14px}details p{max-height:18vh;overflow:auto;white-space:pre-wrap}#diagramViewport{flex:1;min-height:0;overflow:auto;cursor:grab;touch-action:none}#diagramViewport.dragging{cursor:grabbing}#diagramStage{padding:16px;position:relative}#diagramImage{display:block;max-width:none;user-select:none;background:white;box-shadow:0 2px 10px #0001}.hint{font-size:12px;color:#65758a;margin-left:auto}#zoomLabel{min-width:4em;text-align:center}</style></head><body>
<header><nav aria-label="图片查看工具"><button id="zoomFit">适配窗口</button><button id="zoomActual">100%</button><button id="zoomOut" aria-label="缩小">−</button><output id="zoomLabel" aria-live="polite">100%</output><button id="zoomIn" aria-label="放大">＋</button><span class="hint">滚轮缩放 · 拖动平移 · 键盘 + / − / 0</span></nav><details><summary>查看完整句子</summary><p>${escapeHtml(sentence)}</p></details></header>
<main id="diagramViewport" tabindex="0" aria-label="结构图，可拖动或使用键盘缩放"><div id="diagramStage"><img id="diagramImage" draggable="false" alt="句子语法结构图" src="${imageSource(base64, mimeType)}"></div></main><script>${viewerScript}</script></body></html>`;
}

function buildHeader() {
  return `<!DOCTYPE html>
<html><head><meta charset='utf-8'></head><body style='background:#f4f7f6; padding: 20px; max-width: 800px; margin: auto;'>`;
}

function buildFooter() {
  return '</body></html>';
}

function buildParagraphHtml(text) {
  return `<div style="font-family: 'Segoe UI', sans-serif; color: #2c3e50; font-size: 20px; font-weight: bold; margin-top: 30px; margin-bottom: 10px; border-bottom: 2px solid #ecf0f1; padding-bottom: 5px;">${escapeHtml(text)}</div>\n`;
}

function imageDimensions(base64, mimeType) {
  const buffer = Buffer.from(base64, 'base64');
  let width = 0, height = 0;
  if (mimeType === 'image/png' && buffer.length >= 24 && buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    width = buffer.readUInt32BE(16); height = buffer.readUInt32BE(20);
  } else if (mimeType === 'image/svg+xml') {
    const root = buffer.toString('utf8',0,Math.min(buffer.length,8192)).match(/<svg\b[^>]*>/i)?.[0] || '';
    const dimension = name => {
      const value = root.match(new RegExp(`\\b${name}=["']([0-9.]+)(px|pt)?["']`, 'i'));
      return value ? Number(value[1]) * (value[2]?.toLowerCase() === 'pt' ? 4/3 : 1) : 0;
    };
    width = dimension('width'); height = dimension('height');
    if (!width || !height) {
      const box = root.match(/\bviewBox=["']([^"']+)["']/i)?.[1].trim().split(/[\s,]+/).map(Number);
      if (box?.length === 4) { width = box[2]; height = box[3]; }
    }
  }
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? ` data-image-width="${width}" data-image-height="${height}"` : '';
}

function buildSentenceHtml(sentence, base64Img, mimeType, diagramFilename = '') {
  return `
<div class="sentence-diagram">
  <p class="sentence-caption">${escapeHtml(sentence)}</p>
  <div class="diagram-canvas"${imageDimensions(base64Img,mimeType)} tabindex="0" role="group" aria-label="句子结构图画布，点击后滚轮缩放，拖动平移，Esc 退出">
    <img class="canvas-image" draggable="false" loading="lazy" decoding="async" alt="句子语法结构图" src="${imageSource(base64Img, mimeType)}" />
    <div class="canvas-controls" role="group" aria-label="画布缩放工具">
      <button type="button" data-canvas-action="out" aria-label="缩小" title="缩小">−</button><output class="canvas-zoom" aria-live="polite">100%</output><button type="button" data-canvas-action="in" aria-label="放大" title="放大">＋</button>
      <button type="button" data-canvas-action="actual" title="原始大小">100%</button><button type="button" data-canvas-action="fit" aria-label="适配整图" title="适配整图">↺</button>
    </div>
    <span class="canvas-help">点击后滚轮缩放 · 拖动平移</span>
  </div>
</div>\n`;
}

function buildErrorHtml(sentence, message = '此句处理失败，请重试') {
  return `
<div style="font-family: 'Segoe UI', sans-serif; margin-bottom: 20px; text-align: center;">
  <p style="font-size: 16px; color: #e74c3c; text-align: left; background: #fdf2f0; padding: 15px; border-left: 5px solid #e74c3c; border-radius: 4px; margin: 0 0 10px 0;"><b>[⚠️ ${escapeHtml(message)}]</b> ${escapeHtml(sentence)}</p>
</div>\n`;
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buildCompleteStudyHtml(sections, options = {}) {
  const vocabularyData=JSON.stringify(options.vocabulary||{words:[]}).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  const original = normalizeOriginal(options.original);
  const resultData = JSON.stringify({sections})
    .replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  const readingData = JSON.stringify({original,filename:options.filename,sections:sections.map(section=>({paragraph:section.paragraph,sentences:(section.sentences || []).map(sentence=>({text:sentence.text,translation:sentence.translation||''}))}))})
    .replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  const generatedAt = options.generatedAt instanceof Date
    ? options.generatedAt
    : new Date();
  let globalIndex = 0;
  const leftSections = [];
  const rightSections = [];

  for (const [sectionIndex, section] of sections.entries()) {
    const sentences = Array.isArray(section.sentences) ? section.sentences : [];
    const firstIndex = globalIndex;
    globalIndex += sentences.length;

    leftSections.push(buildParallelParagraph(section, firstIndex));

    const firstSentenceIndex = globalIndex - sentences.length;
    const cards = sentences.map((sentence, sentenceIndex) => {
      const index = firstSentenceIndex + sentenceIndex;
      return `<article class="sent-card" data-section="${index}">${sentence.html || ''}</article>`;
    }).join('\n');
    rightSections.push(`
      <section class="analysis-section">
        <h2 class="para-header">第 ${sectionIndex + 1} 段</h2>
        ${cards}
      </section>`);
  }

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>English Sentences Process Decomposition</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; }
    body { font-family: "Segoe UI", system-ui, sans-serif; color: #25364a; background: #eef2f6; }
    .page-header { display: flex; justify-content: space-between; gap: 24px; align-items: baseline; padding: 16px 22px; background: #fff; border-bottom: 1px solid #dbe3ea; }
    .page-header h1 { margin: 0; font-size: 18px; }
    .page-header time { color: #718096; font-size: 12px; }
    .dual-panel { display: grid; grid-template-columns: minmax(320px, 1fr) minmax(480px, 1.5fr); height: calc(100vh - 62px); min-height: 540px; }
    .panel-left, .panel-right { min-width: 0; overflow-y: auto; background: #fff; }
    .panel-left { border-right: 1px solid #dbe3ea; }
    .panel-right { background: #f7f9fb; }
    .panel-header { position: sticky; top: 0; z-index: 5; margin: 0; padding: 11px 16px; background: rgba(255,255,255,.96); border-bottom: 1px solid #dbe3ea; color: #526579; font-size: 13px; }
    .panel-content { padding: 12px; }
    .para-text { padding: 18px 20px; border-bottom: 1px solid #edf1f4; font-family: Georgia, "Times New Roman", serif; font-size: 17px; line-height: 1.85; }
    .sent-span { cursor: pointer; border-radius: 3px; transition: background .15s, box-shadow .15s; }
    .sent-span:hover, .sent-span:focus { outline: none; background: #e8f2fb; }
    .sent-span.highlight { background: #cfe8fb; box-shadow: 0 0 0 2px #cfe8fb; }
    .analysis-section { padding: 0 0 4px; }
    .para-header { margin: 0 12px 12px; padding: 16px 0 8px; border-bottom: 2px solid #e3e9ef; font-size: 16px; color: #526579; }
    .sent-card { margin: 0 12px 18px; scroll-margin-top: 52px; }
    .sent-card > div { margin-bottom: 0 !important; }
    .sent-card img { max-width: 100% !important; height: auto; }
    .sentence-caption { color: #34495e; background: white; border-left: 4px solid #3498db; border-radius: 4px; font: 16px/1.6 'Segoe UI',sans-serif; text-align: left; }
    .para-text { white-space: pre-wrap; }
    .article-image { display: block; max-width: 100%; margin: 10px auto; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,.08); }
    .column-control { font-size: 12px; color: #526579; }
    @media (max-width: 860px) {
      .page-header { align-items: flex-start; flex-direction: column; gap: 4px; }
      .dual-panel { grid-template-columns: 1fr; height: auto; }
      .panel-left, .panel-right { overflow: visible; }
      .panel-left { border-right: 0; border-bottom: 1px solid #dbe3ea; }
      .panel-header { position: static; }
    }
    ${canvasStyle}
    ${readingStyle}
    ${originalStyle}
    ${vocabularyStyle}
    ${workspaceStyle}
  </style>
</head>
<body>
  <header class="page-header">
    <h1>English Sentences Process Decomposition</h1>
    <label class="column-control">原文与译文栏宽 <input id="columnWidth" type="range" min="25" max="60" value="40" aria-label="原文与译文栏宽"></label>
    <time datetime="${generatedAt.toISOString()}">生成时间：${escapeHtml(generatedAt.toLocaleString())}</time>
  </header>
  <main class="dual-panel">
    <section class="panel-left">
      <div class="reading-mode-bar" id="readingModeBar"${original ? '' : ' hidden'}><button id="readingModeToggle" type="button" aria-pressed="false">切换至 EPUB 原版</button><span class="reading-mode-status" id="readingModeStatus" role="status"></span></div>
      <h2 class="panel-header reading-header" id="readingHeader"><span>英文原文</span><span>中文翻译</span></h2>
      <div class="panel-content" id="leftContent">${leftSections.join('\n')}</div>
      <div id="originalContent" hidden></div>
    </section>
    <section class="panel-right" id="panelRight">
      <h2 class="panel-header">句子拆解与思维导图</h2>
      <div class="panel-content" id="rightContent">${rightSections.join('\n')}</div>
    </section>
  </main>
  <script>${canvasScript}</script>
  <script>${navigationScript}</script>
  <script type="application/json" id="epubOriginalData">${readingData}</script>
  <script type="application/json" id="readerResultData">${resultData}</script>
  <script type="application/json" id="passageRecapData">null</script>
  <script>${originalScript}</script>
  <script type="application/json" id="vocabularyData">${vocabularyData}</script>
  <script>${vocabularySharedScript}</script>
  <script>${vocabularyScript}</script>
  <script>${workspaceScript}</script>
  <script>
    (() => {
      document.getElementById('columnWidth').addEventListener('input', event => {
        if (window.innerWidth > 860) document.querySelector('.dual-panel').style.gridTemplateColumns = event.target.value + '% minmax(0,1fr)';
      });
      const data=JSON.parse(document.getElementById('epubOriginalData').textContent);
      Vocabulary.mount({snapshot:JSON.parse(document.getElementById('vocabularyData').textContent),source:document.title});
      const epub=EpubOriginal.mount({original:data.original,sections:data.sections,left:document.querySelector('.panel-left'),right:document.getElementById('panelRight'),
        parallel:document.getElementById('leftContent'),container:document.getElementById('originalContent'),bar:document.getElementById('readingModeBar'),toggle:document.getElementById('readingModeToggle'),status:document.getElementById('readingModeStatus'),header:document.getElementById('readingHeader')});
      ReadingWorkspace.mount({filename:data.filename,recap:JSON.parse(document.getElementById('passageRecapData').textContent),connection:JSON.parse(document.getElementById('vocabularyData').textContent),original:data.original,sections:data.sections,epub,left:document.querySelector('.panel-left'),right:document.getElementById('panelRight')});
    })();
  </script>
</body>
</html>`;
}

module.exports = {
  buildHeader,
  buildFooter,
  buildParagraphHtml,
  buildSentenceHtml,
  buildErrorHtml,
  buildCompleteStudyHtml,
  buildDiagramPage
};
