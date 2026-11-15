(function (root) {
  'use strict';
  function getSentenceRuns(paragraph, sentences) {
    const text = String(paragraph || '');
    const runs = [];
    let cursor = 0;
    (sentences || []).forEach((sentence, index) => {
      const value = String(sentence.text || sentence.my_sentence || '');
      if (!value) return;
      let start = sentence.start;
      let end = sentence.end;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < cursor || text.slice(start, end) !== value) {
        start = text.indexOf(value, cursor);
        end = start + value.length;
      }
      if (start < cursor) return;
      if (start > cursor) runs.push({text: text.slice(cursor, start), index: null});
      runs.push({text: text.slice(start, end), index});
      cursor = end;
    });
    if (cursor < text.length) runs.push({text: text.slice(cursor), index: null});
    return runs;
  }
  function escapeText(value) {
    return String(value || '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[character]));
  }
  const IMAGE_DATA_URI = /^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/;
  // Attaches EPUB illustrations to the paragraph that precedes them. Preview
  // edits (merge/split) keep the anchor working via startsWith/endsWith.
  function attachImages(sections, images) {
    let unmatched = 0;
    for (const image of Array.isArray(images) ? images : []) {
      const anchor = String(image && image.anchor || '').trim();
      const dataUri = String(image && image.dataUri || '');
      if (!IMAGE_DATA_URI.test(dataUri) || dataUri.length > 8 * 1024 * 1024) { unmatched++; continue; }
      let target = -1;
      if (!anchor) target = sections.length ? 0 : -1;
      else {
        for (const test of [p => p === anchor, p => p.startsWith(anchor), p => p.endsWith(anchor), p => p.includes(anchor)]) {
          target = sections.findIndex(section => test(section.paragraph));
          if (target >= 0) break;
        }
      }
      if (target < 0) { unmatched++; continue; }
      const section = sections[target];
      if (!Array.isArray(section.images)) section.images = [];
      section.images.push({dataUri, alt: String(image.alt || ''), position: anchor ? 'after' : 'before'});
    }
    return unmatched;
  }
  function buildArticleImage(image) {
    return `<img class="article-image" src="${image.dataUri}" alt="${escapeText(image.alt || '文章插图')}" loading="lazy" decoding="async">`;
  }
  function buildParallelParagraph(section, offset = 0) {
    const english = [], chinese = [];
    getSentenceRuns(section.paragraph, section.sentences).forEach(run => {
      if (run.index === null) { english.push(escapeText(run.text)); return; }
      const id = offset + run.index;
      const translation = section.sentences[run.index]?.translation;
      const text = typeof translation === 'string' && translation.trim() ? translation : '暂无译文';
      english.push(`<span class="sent-span" data-section="${id}" tabindex="0" role="button">${escapeText(run.text)}</span>`);
      chinese.push(`<span class="translation-text" data-section="${id}" lang="zh-CN" tabindex="0" role="button">${escapeText(text)}</span>`);
    });
    const before = [], after = [];
    for (const image of section.images || []) (image.position === 'before' ? before : after).push(buildArticleImage(image));
    return before.join('') + `<div class="parallel-paragraph"><div class="para-text">${english.join('')}</div><div class="translation-paragraph">${chinese.join('')}</div></div>` + after.join('');
  }
  const api = {getSentenceRuns, buildParallelParagraph, attachImages};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StudyShared = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
