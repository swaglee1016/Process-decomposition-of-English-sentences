// Paragraph boundaries are established before sentence splitting. Offsets are
// JavaScript string (UTF-16) offsets into the paragraph item.
const HONORIFICS = new Set(['Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Prof.', 'Sr.', 'Jr.']);
const NAME_PREFIXES = new Set(['St.', 'Mt.']);
const CLOSERS = /["'”’\)\]]/;

function sentenceRanges(paragraph) {
  const ranges = [];
  let start = 0;
  for (let i = 0; i < paragraph.length; i++) {
    const mark = paragraph[i];
    if (!'.?!'.includes(mark)) continue;
    if (mark === '.' && /\d/.test(paragraph[i - 1] || '') && /\d/.test(paragraph[i + 1] || '')) continue;

    let end = i + 1;
    while (end < paragraph.length && CLOSERS.test(paragraph[end])) end++;
    if (end < paragraph.length && !/\s/.test(paragraph[end])) continue;

    const token = (paragraph.slice(start, i + 1).match(/(?:^|\s)([^\s]+)$/)?.[1] || '')
      .replace(/^["'“‘([{]+/, '');
    const following = paragraph.slice(end).trimStart();
    if (mark === '.') {
      if (HONORIFICS.has(token) || /^[A-Z]\.$/.test(token)) continue;
      if (NAME_PREFIXES.has(token) && /^[A-Z]/.test(following)) continue;
      if (/^(?:[A-Za-z]\.){2,}$/.test(token) || /^(?:etc|p\.m|a\.m)\.$/i.test(token)) {
        if (/^[a-z]/.test(following)) continue;
      }
    }
    if (end > i + 1 && /^[a-z]/.test(following)) continue;

    while (start < end && /\s/.test(paragraph[start])) start++;
    if (end > start) ranges.push([start, end]);
    start = end;
  }
  while (start < paragraph.length && /\s/.test(paragraph[start])) start++;
  let end = paragraph.length;
  while (end > start && /\s/.test(paragraph[end - 1])) end--;
  if (end > start) ranges.push([start, end]);
  return ranges;
}

function splitText(article) {
  if (article && typeof article === 'object') article = article.article || article.text || article.content || '';
  const text = String(article || '').replace(/\r\n?/g, '\n');
  const paragraphs = text.split(/\n\s*\n+/).map(part => part.replace(/\n/g, ' ').trim()).filter(Boolean);
  const items = [];
  for (const paragraph of paragraphs) {
    items.push({ type: 'paragraph', text: paragraph });
    for (const [start, end] of sentenceRanges(paragraph)) {
      items.push({ type: 'sentence', my_sentence: paragraph.slice(start, end), start, end });
    }
  }
  return items;
}

module.exports = { splitText };
