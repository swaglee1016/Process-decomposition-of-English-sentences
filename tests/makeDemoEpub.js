// Generates uploads/demo-novel.epub — a small EPUB 3 sample with a nested
// table of contents (2 parts, 7 chapters) for manually testing EPUB import.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const AdmZip = require('adm-zip');

// Minimal PNG encoder so the demo book carries real illustrations.
function crc32(buf) {
  if (!crc32.table) {
    crc32.table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crc32.table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of buf) crc = crc32.table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}
function makePng(width, height, colorAt) {
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3);
    for (let x = 0; x < width; x++) {
      const [r, g, b] = colorAt(x, y);
      raw[row + 1 + x * 3] = r; raw[row + 2 + x * 3] = g; raw[row + 3 + x * 3] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
const sceneImages = {
  'images/inn.png': makePng(480, 160, (x, y) => [60 + x % 60, 40 + y % 80, 90]),
  'images/chapel.png': makePng(480, 160, (x, y) => [120 - y % 60, 90 + x % 50, 60]),
};
// chapter index → illustration inserted after the given paragraph index
const illustrations = {
  1: [{ after: 0, src: 'images/inn.png', alt: 'The inn at Blackwater Cross' }],
  4: [{ after: 1, src: 'images/chapel.png', alt: 'The abandoned chapel' }],
};

const chapters = [
  { part: 'Part I — Arrival', title: 'Chapter 1 — The Letter', paragraphs: [
    'The letter arrived on a Tuesday morning, wrapped in brown paper and smelling faintly of salt.',
    'Mr. Hartley turned it over twice before opening it. "From Halifax," he muttered. "Nobody writes to me from Halifax."',
    'His sister watched him from the doorway. She had known, long before he did, that the past would eventually come knocking.',
  ]},
  { part: 'Part I — Arrival', title: 'Chapter 2 — A Stranger at the Inn', paragraphs: [
    'The inn at Blackwater Cross had seen better decades. Its sign creaked in the wind, and the windows glowed with a tired amber light.',
    'A stranger sat alone by the fire, his boots still muddy from the road. He did not look up when Hartley entered, but his hand tightened around his glass.',
    '"You came sooner than I expected," the stranger said. "Sit down. There is a great deal you need to understand."',
    'Hartley sat. Outside, the rain began again, soft and persistent, as though the sky itself were keeping secrets.',
  ]},
  { part: 'Part I — Arrival', title: 'Chapter 3 — The Map', paragraphs: [
    'The map was old, drawn in faded ink on cloth that crackled when unfolded. A red line wound through hills that Hartley did not recognize.',
    '"This mark," said the stranger, tapping a cross near the coast, "is where your father buried the ledger."',
    'Hartley stared at the mark for a long time. He thought of his father, silent and severe, and wondered how much of the man he had never truly known.',
  ]},
  { part: 'Part II — The Search', title: 'Chapter 4 — Northward', paragraphs: [
    'They left before dawn, two figures on horseback moving north along the ridge. The valley below was filled with mist.',
    'By noon they had crossed the river at Miller\'s Ford, where the water ran cold and fast over grey stones.',
    '"How much further?" Hartley asked. The stranger only pointed toward the distant line of hills.',
  ]},
  { part: 'Part II — The Search', title: 'Chapter 5 — The Abandoned Chapel', paragraphs: [
    'The chapel stood alone on the hillside, its roof half fallen, its door hanging from a single hinge.',
    'Inside, the floor was covered with leaves and the nests of swallows. Light fell through the broken roof in pale columns.',
    'They found the loose stone beneath the altar, just as the map had promised. Hartley\'s hands trembled as he lifted it.',
    'The hollow beneath was empty, except for a single iron key and a scrap of paper that read: "Ask your sister."',
  ]},
  { part: 'Part II — The Search', title: 'Chapter 6 — The Truth', paragraphs: [
    'His sister did not seem surprised when he confronted her. She poured tea, sat down, and folded her hands.',
    '"Father did not bury a ledger," she said quietly. "He buried a confession. I moved it years ago, to keep it safe."',
    'Hartley felt the ground shift beneath everything he had believed. "Safe from whom?" he asked.',
    '"From the man you rode north with," she replied. "He is not who he claims to be."',
  ]},
  { part: 'Part II — The Search', title: 'Chapter 7 — Homecoming', paragraphs: [
    'The journey home took three days, though Hartley could not later recall a single mile of it.',
    'When the house finally appeared between the trees, its windows glowing amber like the inn at Blackwater Cross, he understood that some journeys end where they begin.',
    'He dismounted, walked up the path, and knocked on his own door like a stranger. His sister opened it, and this time, he told her everything.',
  ]},
];

function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function chapterPage(chapter, index) {
  const paragraphs = chapter.paragraphs.slice();
  for (const image of illustrations[index] || []) {
    paragraphs.splice(image.after + 1, 0, `<img src="${image.src}" alt="${esc(image.alt)}"/>`);
  }
  const paras = paragraphs.map(p => `    <p>${p.startsWith('<img') ? p : esc(p)}</p>`).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${esc(chapter.title)}</title></head>
<body>
  <section>
    <h1>${esc(chapter.title)}</h1>
${paras}
  </section>
</body>
</html>`;
}

const zip = new AdmZip();
zip.addFile('mimetype', Buffer.from('application/epub+zip', 'utf8'));
zip.addFile('META-INF/container.xml', Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`, 'utf8'));

const manifestItems = chapters.map((c, i) =>
  `    <item id="ch${i + 1}" href="ch${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join('\n');
const manifestImages = Object.keys(sceneImages).map((name, i) =>
  `    <item id="img${i + 1}" href="${name}" media-type="image/png"/>`).join('\n');
zip.addFile('OEBPS/content.opf', Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">demo-novel-0001</dc:identifier>
    <dc:title>The Ledger of Blackwater Cross</dc:title>
    <dc:language>en</dc:language>
    <dc:creator>Demo Author</dc:creator>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${manifestItems}
${manifestImages}
  </manifest>
  <spine>
${chapters.map((c, i) => `    <itemref idref="ch${i + 1}"/>`).join('\n')}
  </spine>
</package>`, 'utf8'));

const parts = [];
for (const chapter of chapters) {
  if (!parts.length || parts.at(-1).name !== chapter.part) parts.push({ name: chapter.part, chapters: [] });
  parts.at(-1).chapters.push(chapter);
}
let chapterIndex = 0;
const navItems = parts.map(part => {
  const firstChapter = chapterIndex + 1;
  const items = part.chapters.map(() => {
    chapterIndex++;
    return `        <li><a href="ch${chapterIndex}.xhtml">${esc(chapters[chapterIndex - 1].title)}</a></li>`;
  }).join('\n');
  return `      <li><a href="ch${firstChapter}.xhtml">${esc(part.name)}</a>\n      <ol>\n${items}\n      </ol></li>`;
}).join('\n');
zip.addFile('OEBPS/nav.xhtml', Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body>
  <nav epub:type="toc">
    <h1>Contents</h1>
    <ol>
${navItems}
    </ol>
  </nav>
</body>
</html>`, 'utf8'));

chapters.forEach((chapter, i) => {
  zip.addFile(`OEBPS/ch${i + 1}.xhtml`, Buffer.from(chapterPage(chapter, i), 'utf8'));
});
for (const [name, data] of Object.entries(sceneImages)) zip.addFile(`OEBPS/${name}`, data);

const target = path.join(__dirname, '..', 'uploads', 'demo-novel.epub');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, zip.toBuffer());
console.log('written:', target);

// Self-check with the project parser.
const { parseEpub } = require('../services/epubParser');
const book = parseEpub(fs.readFileSync(target));
console.log('title:', book.title);
for (const c of book.chapters) {
  const words = c.text ? c.text.split(/\s+/).length : 0;
  const flags = [c.group ? 'group' : '', (c.images || []).length ? `${c.images.length} image(s)` : ''].filter(Boolean).join(', ');
  console.log(`${'  '.repeat(c.depth)}[${c.id}] ${c.title} — ${words} words${flags ? ` (${flags})` : ''}`);
}
