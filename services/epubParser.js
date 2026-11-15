// EPUB (ZIP + OPF) parsing: table of contents and per-chapter plain text.
// Chapter text keeps one line per XHTML paragraph, which matches the
// paragraphSplitter 'preserve' mode — no AI paragraph repair is needed.
const AdmZip = require('adm-zip');
const {parseDocument,DomUtils} = require('htmlparser2');

function decodeEntities(value) {
  return DomUtils.textContent(parseDocument(String(value||'')));
}

function parseAttributes(tag) {
  const attributes = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) attributes[match[1]] = decodeEntities(match[2]);
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*'([^']*)'/g)) {
    if (!(match[1] in attributes)) attributes[match[1]] = decodeEntities(match[2]);
  }
  return attributes;
}

// Joins paths inside the EPUB archive (always forward slashes).
function resolvePath(baseDir, href) {
  const decoded = decodeURIComponent(String(href || ''));
  const parts = (baseDir ? baseDir + '/' + decoded : decoded).split('/');
  const out = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

function dirOf(filePath) {
  const index = filePath.lastIndexOf('/');
  return index < 0 ? '' : filePath.slice(0, index);
}

const BLOCK_TAG = '(?:p|div|h[1-6]|li|blockquote|section|article|tr|td|th|dt|dd|figcaption|pre)';

function htmlToText(source) {
  let text = String(source || '')
    .replace(/<head\b[\s\S]*?<\/head>/gi, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  // HTML source line wrapping is whitespace, not a paragraph boundary.
  // Preserve intentional preformatted line breaks before folding source lines.
  text = text.replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi,
    block => block.replace(/\r\n?|\n/g, '<br/>')).replace(/[\r\n\t]+/g, ' ');
  text = text
    .replace(new RegExp(`</${BLOCK_TAG}>`, 'gi'), '\n')
    .replace(/<br\b[^>]*\/?>/gi, '\n')
    .replace(new RegExp(`<${BLOCK_TAG}\\b[^>]*>`, 'gi'), '\n');
  text = decodeEntities(text.replace(/<[^>]+>/g, ''));
  return text.split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}

const IMAGE_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ORIGINAL_MIME = {...IMAGE_MIME, '.woff':'font/woff', '.woff2':'font/woff2', '.ttf':'font/ttf', '.otf':'font/otf'};

function originalChapter(documentHtml, fragmentHtml, filename, readStylesheet, readBinary, resources, consumeOriginal) {
  const baseDir = dirOf(filename), styles = [], resourcePaths = new Set(), seenStyles = new Set();
  function archivePath(href, directory) {
    if (!href || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) return '';
    try { return resolvePath(directory, href.split(/[?#]/)[0]); } catch { return ''; }
  }
  function resource(href, directory) {
    const location = archivePath(href, directory);
    const extension = location.match(/\.[a-z0-9]+$/i)?.[0].toLowerCase();
    const mime = ORIGINAL_MIME[extension];
    if (!location || !mime) return;
    if (!Object.hasOwn(resources,location)) {
      const data = readBinary(location);
      if (!data || data.length > MAX_IMAGE_BYTES) return;
      consumeOriginal(Math.ceil(data.length * 4 / 3));
      resources[location] = `data:${mime};base64,${data.toString('base64')}`;
    }
    resourcePaths.add(location);
  }
  function stylesheet(css, directory, depth = 0) {
    if (depth > 8 || styles.length >= 64) throw new Error('EPUB 书内样式数量或嵌套层级超过限制');
    consumeOriginal(Buffer.byteLength(css,'utf8'));
    for (const match of css.matchAll(/@import\s+(?:url\(\s*)?["']([^"']+)["']/gi)) {
      const location = archivePath(match[1],directory);
      if (location && !seenStyles.has(location)) {
        seenStyles.add(location);
        const imported = readStylesheet(location);
        if (imported !== null) stylesheet(imported,dirOf(location),depth+1);
      }
    }
    for (const match of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) resource(match[1].trim(),directory);
    styles.push({css,baseDir:directory});
  }
  for (const match of documentHtml.matchAll(/<link\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0]);
    if (!/\bstylesheet\b/i.test(attributes.rel || '')) continue;
    const location = archivePath(attributes.href,baseDir);
    if (location && !seenStyles.has(location)) {
      seenStyles.add(location);
      const css = readStylesheet(location);
      if (css !== null) stylesheet(css,dirOf(location));
    }
  }
  for (const match of documentHtml.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) stylesheet(match[1],baseDir);
  for (const match of fragmentHtml.matchAll(/<(?:img|image)\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0]);
    resource(attributes.src || attributes['xlink:href'] || attributes.href,baseDir);
  }
  const inlineSource = fragmentHtml+(documentHtml.match(/<(?:html|body)\b[^>]*>/gi) || []).join('');
  for (const match of inlineSource.matchAll(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    for (const url of (match[1] || match[2]).matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) resource(url[1].trim(),baseDir);
  }
  const bodyAttributes = parseAttributes(documentHtml.match(/<body\b[^>]*>/i)?.[0] || '');
  const htmlAttributes = parseAttributes(documentHtml.match(/<html\b[^>]*>/i)?.[0] || '');
  const body = fragmentHtml.match(/<body\b[^>]*>([\s\S]*?)(?:<\/body>|$)/i)?.[1] ?? fragmentHtml;
  consumeOriginal(Buffer.byteLength(body,'utf8'));
  return {html:body,baseDir,bodyAttributes,htmlAttributes,styles,resourcePaths:[...resourcePaths]};
}

// Text plus embedded illustrations. Each image is anchored to the paragraph
// that precedes it, so it can be re-inserted into the article column later.
function extractContent(source, baseDir, readBinary) {
  const html = String(source || '')
    .replace(/<head\b[\s\S]*?<\/head>/gi, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const parts = [];
  const imageTags = [];
  let lastIndex = 0, match;
  const imageRe = /<(?:img|image)\b[^>]*>/gi;
  while ((match = imageRe.exec(html))) {
    parts.push(html.slice(lastIndex, match.index));
    const attributes = parseAttributes(match[0]);
    imageTags.push({
      partIndex: parts.length - 1,
      src: attributes.src || attributes['xlink:href'] || attributes.href || '',
      alt: attributes.alt || '',
    });
    lastIndex = imageRe.lastIndex;
  }
  parts.push(html.slice(lastIndex));
  const partLines = parts.map(part => {
    const text = htmlToText(part);
    return text ? text.split('\n') : [];
  });
  const images = [];
  for (const tag of imageTags) {
    if (!tag.src || /^(?:data:|https?:)/i.test(tag.src)) continue;
    const extension = (tag.src.split(/[?#]/)[0].match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase();
    const mimeType = IMAGE_MIME[extension];
    if (!mimeType) continue;
    const data = readBinary(resolvePath(baseDir, tag.src));
    if (!data || data.length > MAX_IMAGE_BYTES) continue;
    let anchor = '';
    for (let i = 0; i <= tag.partIndex; i++) {
      if (partLines[i].length) anchor = partLines[i][partLines[i].length - 1];
    }
    images.push({ anchor, alt: tag.alt, dataUri: `data:${mimeType};base64,${data.toString('base64')}` });
  }
  return { text: partLines.flat().join('\n'), images };
}

function parseEpub(buffer) {
  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new Error('无法解析 EPUB 文件：这不是一个有效的 EPUB 压缩包');
  }
  const files = new Map();
  for (const entry of zip.getEntries()) {
    if (!entry.isDirectory) files.set(entry.entryName, entry);
  }
  let textBytes = 0;
  const textCache = new Map();
  const readFile = name => {
    if (textCache.has(name)) return textCache.get(name);
    const entry = files.get(name);
    if (entry && entry.header.size > 8 * 1024 * 1024) throw new Error('EPUB 单个文本文件超过 8 MB，请使用较小的文件');
    if (!entry) return null;
    if (textBytes + entry.header.size > 32 * 1024 * 1024) throw new Error('EPUB 累计文本超过 32 MB，请分册处理');
    const data = entry.getData();textBytes += data.length;
    if (textBytes > 32 * 1024 * 1024) throw new Error('EPUB 累计文本超过 32 MB，请分册处理');
    const value = data.toString('utf8');
    if(!Buffer.from(value,'utf8').equals(data))throw new Error('EPUB 文本编码不是有效 UTF-8，已停止读取以避免正文乱码或缺字');
    textCache.set(name,value);return value;
  };
  const stylesheetCache = new Map();
  const readStylesheet = name => {
    const entry = files.get(name);
    if (!entry) return null;
    if (entry.header.size > 2 * 1024 * 1024) throw new Error('EPUB 书内样式超过 2 MB，请使用较小的文件');
    if (!stylesheetCache.has(name)) stylesheetCache.set(name,entry.getData().toString('utf8'));
    return stylesheetCache.get(name);
  };
  let originalBytes = 0;
  const consumeOriginal = bytes => {
    originalBytes += bytes;
    if (originalBytes > 64 * 1024 * 1024) throw new Error('EPUB 原版资源累计超过 64 MB，请使用较小的文件');
  };
  const readBinary = name => {
    const entry = files.get(name);
    return entry && entry.header.size <= MAX_IMAGE_BYTES ? entry.getData() : null;
  };
  const {inspectNavigation} = require('./epubNavigation');
  const inspection = inspectNavigation(readFile, htmlToText,[...files.keys()].filter(name=>/\.x?html?$/i.test(name)));
  const originalResources = Object.create(null);
  const allDocuments = [...inspection.documents,...inspection.additionalDocuments].map((document,index) => {
    const content = extractContent(document.html,dirOf(document.path),readBinary);
    const firstLine=content.text.split('\n',1)[0].slice(0,65);
    return {id:document.id,path:document.path,kind:document.kind,title:'书内材料 '+(index+1)+(firstLine?' · '+firstLine:''),...content,
      original:originalChapter(document.html,document.html,document.path,readStylesheet,readBinary,originalResources,consumeOriginal)};
  });
  const documents=allDocuments.slice(0,inspection.documents.length);
  const sourceByPath = new Map([...inspection.documents,...inspection.additionalDocuments].map(document=>[document.path,document]));
  const documentByPath = new Map(allDocuments.map(document=>[document.path,document]));
  function materialize(entry) {
    const parts = entry.ranges.map(range=>{
      const source=sourceByPath.get(range.path),document=documentByPath.get(range.path);
      if(range.start===source.start&&range.end===source.end)return {...document,original:document.original};
      const fragment=source.html.slice(range.start,range.end);
      return {...extractContent(fragment,dirOf(range.path),readBinary),
        original:originalChapter(source.html,fragment,range.path,readStylesheet,readBinary,originalResources,consumeOriginal)};
    });
    const originals=parts.map(part=>part.original);
    return {id:entry.id,title:entry.title,depth:entry.depth,kind:entry.kind,group:!!entry.group,
      evidence:entry.evidence,ranges:entry.ranges,
      text:parts.map(part=>part.text).filter(Boolean).join('\n'),images:parts.flatMap(part=>part.images),
      original:originals[0]||null,...(originals.length>1?{originalParts:originals}:{})};
  }
  const chapters = inspection.entries.map(materialize);
  const candidates = inspection.candidates.map(materialize);
  // Full reading follows the complete spine, including the publisher's contents page.
  const readingItems = allDocuments;
  const integrity=require('./epubIntegrity').checkBookIntegrity(sourceByPath,readingItems,chapters);
  return {title:inspection.meta.title||'未命名书籍',documents,readingItems,chapters,originalResources,integrity,
    navigation:{...inspection.navigation,entries:chapters,candidates},
    tocSource:inspection.navigation.source==='headings'?'headings':inspection.navigation.source?'navigation':'spine'};
}

module.exports = { parseEpub };
