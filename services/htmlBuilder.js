/**
 * HTML 组装 — 迁移自 n8n "Init HTML" / "1. 组装段落 HTML" / "3. 组装图片 HTML" / "Download HTML" 节点
 */

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

function buildSentenceHtml(sentence, base64Img, mimeType) {
  return `
<div style="font-family: 'Segoe UI', sans-serif; margin-bottom: 20px; text-align: center;">
  <p style="font-size: 16px; color: #34495e; text-align: left; background: #ffffff; padding: 15px; border-left: 5px solid #3498db; border-radius: 4px; line-height: 1.6; box-shadow: 0 2px 5px rgba(0,0,0,0.02); margin: 0 0 10px 0;">${escapeHtml(sentence)}</p>
  <img src="data:${mimeType};base64,${base64Img}" style="max-width: 100%; border: 1px solid #e0e0e0; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.08); margin-top: 5px;" />
</div>\n`;
}

function buildErrorHtml(sentence) {
  return `
<div style="font-family: 'Segoe UI', sans-serif; margin-bottom: 20px; text-align: center;">
  <p style="font-size: 16px; color: #e74c3c; text-align: left; background: #fdf2f0; padding: 15px; border-left: 5px solid #e74c3c; border-radius: 4px; margin: 0 0 10px 0;"><b>[⚠️ 此句 AI 语法出错，跳过画图]</b> ${escapeHtml(sentence)}</p>
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
  const generatedAt = options.generatedAt instanceof Date
    ? options.generatedAt
    : new Date();
  let globalIndex = 0;
  const leftSections = [];
  const rightSections = [];

  for (const [sectionIndex, section] of sections.entries()) {
    const sentences = Array.isArray(section.sentences) ? section.sentences : [];
    const leftSentences = sentences.length > 0
      ? sentences.map((sentence) => {
        const index = globalIndex++;
        return `<span class="sent-span" data-section="${index}" tabindex="0">${escapeHtml(sentence.text)}</span>`;
      }).join(' ')
      : escapeHtml(section.paragraph);

    leftSections.push(`<div class="para-text">${leftSentences}</div>`);

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
    @media (max-width: 860px) {
      .page-header { align-items: flex-start; flex-direction: column; gap: 4px; }
      .dual-panel { grid-template-columns: 1fr; height: auto; }
      .panel-left, .panel-right { overflow: visible; }
      .panel-left { border-right: 0; border-bottom: 1px solid #dbe3ea; }
      .panel-header { position: static; }
    }
  </style>
</head>
<body>
  <header class="page-header">
    <h1>English Sentences Process Decomposition</h1>
    <time datetime="${generatedAt.toISOString()}">生成时间：${escapeHtml(generatedAt.toLocaleString())}</time>
  </header>
  <main class="dual-panel">
    <section class="panel-left">
      <h2 class="panel-header">排版好的文章</h2>
      <div class="panel-content">${leftSections.join('\n')}</div>
    </section>
    <section class="panel-right" id="panelRight">
      <h2 class="panel-header">句子拆解与思维导图</h2>
      <div class="panel-content" id="rightContent">${rightSections.join('\n')}</div>
    </section>
  </main>
  <script>
    (() => {
      const leftItems = Array.from(document.querySelectorAll('.sent-span'));
      const rightItems = Array.from(document.querySelectorAll('.sent-card'));
      const rightPanel = document.getElementById('panelRight');
      const activate = (index, shouldScroll) => {
        leftItems.forEach((item) => item.classList.toggle('highlight', item.dataset.section === index));
        const target = document.querySelector('.sent-card[data-section="' + index + '"]');
        if (shouldScroll && target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
      leftItems.forEach((item) => {
        const open = () => activate(item.dataset.section, true);
        item.addEventListener('click', open);
        item.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') open();
        });
      });
      if ('IntersectionObserver' in window && rightPanel && rightItems.length) {
        const visibility = new Map();
        const observer = new IntersectionObserver((entries) => {
          entries.forEach((entry) => visibility.set(entry.target, entry.intersectionRatio));
          let best = null;
          let ratio = 0;
          visibility.forEach((value, item) => {
            if (value > ratio) { ratio = value; best = item; }
          });
          if (best && ratio > 0.05) activate(best.dataset.section, false);
        }, { root: rightPanel, threshold: [0, .1, .25, .5, .75] });
        rightItems.forEach((item) => observer.observe(item));
      }
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
  buildCompleteStudyHtml
};
