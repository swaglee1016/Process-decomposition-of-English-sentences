const test = require('node:test');
const assert = require('node:assert/strict');
const AdmZip = require('adm-zip');
const {parseEpub} = require('../services/epubParser');
const {buildCompleteStudyHtml} = require('../services/htmlBuilder');

function originalFixture() {
  const zip = new AdmZip();
  const files = {
    'META-INF/container.xml':'<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>',
    'OPS/book.opf':'<package><manifest><item id="nav" href="nav.xhtml" properties="nav"/><item id="c" href="text/ch.xhtml"/></manifest><spine><itemref idref="c"/></spine></package>',
    'OPS/nav.xhtml':'<nav epub:type="toc"><ol><li><a href="text/ch.xhtml#a">First</a></li><li><a href="text/ch.xhtml#b">Second</a></li></ol></nav>',
    'OPS/text/ch.xhtml':'<html lang="en" class="book-root"><head><link rel="stylesheet" href="../css/book.css"/></head><body class="novel"><section id="a"><h1>First</h1><p>She <em>waited</em>.</p><img src="../images/scene.png"/></section><section id="b"><h2>Second</h2><p>Rain fell.</p></section></body></html>',
    'OPS/css/book.css':'@import "extra.css"; body.novel{font-family:BookFont} em{color:#703040} @font-face{font-family:BookFont;src:url(../fonts/book.woff2)}',
    'OPS/css/extra.css':'h1{text-align:center} p{text-indent:1.5em}',
    'OPS/images/scene.png':Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==','base64'),
    'OPS/fonts/book.woff2':Buffer.from('fixture-font'),
  };
  for (const [name,value] of Object.entries(files)) zip.addFile(name,Buffer.from(value));
  return zip.toBuffer();
}

test('EPUB original chapters preserve markup, body classes, shared styles and embedded assets', () => {
  const book = parseEpub(originalFixture());
  assert.ok(book.chapters[0].original,'original markup must be retained');
  assert.match(book.chapters[0].original.html,/<em>waited<\/em>/);
  assert.doesNotMatch(book.chapters[0].original.html,/Rain fell/);
  assert.match(book.chapters[1].original.html,/Rain fell/);
  assert.equal(book.chapters[0].original.bodyAttributes.class,'novel');
  assert.equal(book.chapters[0].original.htmlAttributes.class,'book-root');
  assert.equal(book.chapters[0].original.htmlAttributes.lang,'en');
  assert.ok(book.chapters[0].original.styles.some(style => style.css.includes('text-indent:1.5em')));
  assert.match(book.originalResources['OPS/images/scene.png'],/^data:image\/png;base64,/);
  assert.match(book.originalResources['OPS/fonts/book.woff2'],/^data:font\/woff2;base64,/);
});

test('offline export includes the original toggle and safely encodes untrusted book markup', () => {
  const html = buildCompleteStudyHtml([{paragraph:'She waited.',sentences:[{text:'She waited.',translation:'她等着。'}]}],{
    original:{chapters:[{title:'First',html:'<p>She waited.</p><script>parent.compromised=true</script>',baseDir:'OPS',styles:[],bodyAttributes:{}}],resources:{}}
  });
  assert.match(html,/id="readingModeToggle"/);
  assert.match(html,/id="epubOriginalData"/);
  assert.doesNotMatch(html,/<script>parent\.compromised=true<\/script>/);
  assert.match(html,/\\u003cscript>/);
});

test('original resource paths resolve relative references without accepting external URLs', () => {
  const {resolveResource,normalizeOriginal} = require('../public/epubOriginal');
  const resources = {'OPS/img.png':'data:image/png;base64,YQ=='};
  assert.equal(resolveResource('../img.png','OPS/text',resources),'data:image/png;base64,YQ==');
  for (const url of ['https://example.com/a.png','//example.com/a.png','javascript:alert(1)','file:///C:/private.png']) {
    assert.equal(resolveResource(url,'OPS',resources),'');
  }
  assert.throws(()=>normalizeOriginal({chapters:[{html:'<p>A</p>'}],resources:{x:'javascript:alert(1)'}}),/resource/i);
  assert.throws(()=>normalizeOriginal({chapters:'invalid'}),/original/i);
});

test('compressed EPUB stylesheets exceeding the limit are rejected during import', () => {
  const zip = new AdmZip(originalFixture());
  zip.updateFile('OPS/css/book.css',Buffer.from('/*'+ 'x'.repeat(3 * 1024 * 1024)+'*/'));
  assert.throws(()=>parseEpub(zip.toBuffer()),/样式.*2 MB/);
});

module.exports = {originalFixture};
