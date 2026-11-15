const { parseAndFix } = require('./plantumlCode');

function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid analysis schema: ${label} is required`);
  return value;
}

function allowedGap(gap) {
  return /^[\s\p{P}]*$/u.test(gap);
}
function canonicalText(text){
  const starts=[],ends=[];let value='',at=0;
  for(const character of text){const start=at;at+=character.length;
    const canonical=/\s/u.test(character)?' ':/[‘’]/u.test(character)?"'":/[“”]/u.test(character)?'"':/[‐‑–—]/u.test(character)?'-':character;
    if(canonical===' '&&value.endsWith(' ')){ends[ends.length-1]=at;continue;}
    for(let unit=0;unit<canonical.length;unit++){value+=canonical[unit];starts.push(start);ends.push(at);}
  }return {value,starts,ends};
}

// Match every supplied span to its actual UTF-16 location. The model may return
// parts in any order, and repeated words require distinct nonoverlapping spans.
function locateSpans(source, entries, { cover = false, label = 'part' } = {}) {
  if (!Array.isArray(entries) || !entries.length || entries.length > 64) throw new Error(`Invalid analysis schema: ${label}s required`);
  const candidates = entries.map((entry, index) => {
    const value = requireText(entry?.text, `${label}.text`);
    const positions = [];
    for (let at = source.indexOf(value); at !== -1; at = source.indexOf(value, at + 1)) {
      positions.push({ index, start: at, end: at + value.length });
      if (positions.length > 128) break;
    }
    if (!positions.length) {
      const actual=canonicalText(source),expected=canonicalText(value).value.trim();
      if(expected)for(let at=actual.value.indexOf(expected);at!==-1;at=actual.value.indexOf(expected,at+1)){
        positions.push({index,start:actual.starts[at],end:actual.ends[at+expected.length-1]});if(positions.length>128)break;
      }
    }
    if (!positions.length) throw new Error(`${label} text does not occur in source`);
    return positions;
  });
  const searchOrder = candidates.map((_, index) => index).sort((a, b) => candidates[a].length - candidates[b].length);
  const chosen = new Array(entries.length);
  let searchSteps = 0;

  function find(depth) {
    if (++searchSteps > 10000) throw new Error('Analysis source matching search limit exceeded');
    if (depth === searchOrder.length) {
      const sorted = [...chosen].sort((a, b) => a.start - b.start);
      if (cover) {
        let cursor = 0;
        for (const range of sorted) {
          if (!allowedGap(source.slice(cursor, range.start))) return null;
          cursor = range.end;
        }
        if (!allowedGap(source.slice(cursor))) return null;
      }
      return sorted;
    }
    const index = searchOrder[depth];
    for (const range of candidates[index]) {
      if (chosen.some(other => other && range.start < other.end && other.start < range.end)) continue;
      chosen[index] = range;
      const result = find(depth + 1);
      if (result) return result;
      chosen[index] = undefined;
    }
    return null;
  }

  const ranges = find(0);
  if (!ranges) throw new Error(cover ? 'Parts do not cover the source sentence' : `${label} spans overlap in source`);
  return ranges.map(range => ({ ...entries[range.index], text:source.slice(range.start,range.end),start: range.start, end: range.end }));
}

const ENTITIES = {
  // PlantUML renders named &quot; literally; its numeric equivalent preserves quotes.
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&#34;', "'": '&#39;',
  '@': '&#64;', '!': '&#33;', '*': '&#42;', '[': '&#91;', ']': '&#93;',
  '{': '&#123;', '}': '&#125;', '~': '&#126;', '\\': '&#92;',
  '%': '&#37;', '/': '&#47;', '_': '&#95;', '-': '&#45;', '^': '&#94;',
  '$': '&#36;', '#': '&#35;', '=': '&#61;', '|': '&#124;', '`': '&#96;'
};

function safeLabel(value) {
  const plain = String(value).replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').trim();
  const words = plain.match(/\S+/gu) || [];
  const lines = [];
  let line = '', count = 0;
  for (const word of words) {
    const chunks = [];
    const characters = [...word];
    const maxWidth = /\p{Script=Han}/u.test(word) ? 22 : 40;
    for (let start = 0; start < characters.length; start += maxWidth) chunks.push(characters.slice(start, start + maxWidth).join(''));
    for (const chunk of chunks) {
      const lineWidth = /\p{Script=Han}/u.test(line + chunk) ? 24 : 40;
      if (line && (count >= 7 || [...line].length + 1 + [...chunk].length > lineWidth)) {
        lines.push(line); line = ''; count = 0;
      }
      line = line ? `${line} ${chunk}` : chunk;
      count++;
    }
  }
  if (line) lines.push(line);
  return lines.map(segment => segment.replace(/[&<>"'@!*\[\]{}~\\%\/_\-^$#=|`]/g, char => ENTITIES[char])).join('\\n');
}

function legacyTranslation(puml) {
  const match = puml.match(/^\*{2}\s*(?:中文翻译|整句翻译)[：:]\s*([^\r\n]*)/m);
  return match ? match[1].replace(/%%%/g, '').trim() : '';
}

function legacyCode(puml) {
  let skippedDepth = 0;
  return parseAndFix(puml).split('\n').filter(line => {
    const node = line.match(/^(\*+)\s*(.*)$/);
    if (!node) return true;
    const depth = node[1].length;
    if (skippedDepth && depth > skippedDepth) return false;
    skippedDepth = depth >= 2 && /^(?:中文翻译|整句翻译|翻译)[：:]/.test(node[2]) ? depth : 0;
    return !skippedDepth;
  }).join('\n');
}

function parseAnalysis(rawContent, sentence) {
  let parsed;
  if (rawContent && typeof rawContent === 'object') {
    parsed = rawContent;
  } else {
    const content = String(rawContent || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    try { parsed = JSON.parse(content); }
    catch {
      if (/^@startmindmap\b/.test(content)) {
        return { code: legacyCode(content), translation: legacyTranslation(content), ordered: [] };
      }
      throw new Error('Invalid analysis JSON');
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid analysis schema');
  if (typeof parsed.puml === 'string' && !Object.hasOwn(parsed, 'parts')) {
    return { code: legacyCode(parsed.puml), translation: legacyTranslation(parsed.puml), ordered: [] };
  }

  const source = requireText(sentence, 'source sentence');
  const type = requireText(parsed.sentenceType, 'sentenceType');
  const translation = requireText(parsed.translation, 'translation');
  // Validate source coverage first, then omit punctuation-only drawing nodes.
  // The untouched source node still displays every original punctuation mark.
  const ordered = locateSpans(source, parsed.parts, { cover: true }).filter(part => !allowedGap(part.text));
  for (const part of ordered) {
    requireText(part.role, 'part.role');
    requireText(part.translation, 'part.translation');
    if (part.details !== undefined) {
      if (!Array.isArray(part.details)) throw new Error('Invalid analysis schema: details must be an array');
      part.details = part.details.length ? locateSpans(part.text, part.details, { label: 'detail' }).filter(detail => !allowedGap(detail.text)).map(detail => {
        requireText(detail.role, 'detail.role');
        requireText(detail.translation, 'detail.translation');
        return { ...detail, start: part.start + detail.start, end: part.start + detail.end };
      }) : [];
    }
  }
  const notes = parsed.grammarNotes === undefined ? [] :
    (Array.isArray(parsed.grammarNotes) ? parsed.grammarNotes : [parsed.grammarNotes]);
  if (notes.some(note => typeof note !== 'string')) throw new Error('Invalid analysis schema: grammarNotes must be text');

  const lines = ['@startmindmap', 'scale 2', 'left to right direction', `* ${safeLabel(type)}`,
    `** 原文：${safeLabel(source)}`];
  const grammar = notes.filter(note => note.trim()).map(safeLabel);
  if (grammar.length) lines.push(`*** 核心语法点：\\n${grammar.join('\\n')}`);
  ordered.forEach((part, index) => {
    const gloss = part.details?.length ? '' : `｜${safeLabel(part.translation)}`;
    lines.push(`** ${index + 1}. ${safeLabel(part.role)}：${safeLabel(part.text)}${gloss}`);
    part.details?.forEach((detail, detailIndex) => {
      lines.push(`*** ${index + 1}.${detailIndex + 1} ${safeLabel(detail.role)}：${safeLabel(detail.text)}｜${safeLabel(detail.translation)}`);
    });
  });
  lines.push('@endmindmap');
  return { code: lines.join('\n'), translation, ordered };
}

module.exports = { parseAnalysis };
