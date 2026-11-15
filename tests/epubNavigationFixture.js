const AdmZip = require('adm-zip');

function makeBook({pages, nav, ncx, guide = '', title = 'Sample Book', creator = 'Sample Author', extra = {}}) {
  const files = {...pages, ...extra};
  if (nav !== undefined) files['nav.xhtml'] = nav;
  if (ncx !== undefined) files['toc.ncx'] = ncx;
  const manifest = Object.keys(pages).map((href,index)=>`<item id="p${index}" href="${href}" media-type="application/xhtml+xml"/>`).join('');
  const opf = `<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0"><metadata><dc:title>${title}</dc:title><dc:creator>${creator}</dc:creator></metadata><manifest>${manifest}${nav !== undefined?'<item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>':''}${ncx !== undefined?'<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>':''}</manifest><spine toc="ncx">${Object.keys(pages).map((_,index)=>`<itemref idref="p${index}"/>`).join('')}</spine><guide>${guide}</guide></package>`;
  const zip = new AdmZip();
  zip.addFile('META-INF/container.xml',Buffer.from('<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>'));
  zip.addFile('OPS/book.opf',Buffer.from(opf));
  for (const [name,html] of Object.entries(files)) zip.addFile('OPS/'+name,Buffer.from(html));
  return zip.toBuffer();
}
function page(body, title = 'Sample Book') {return `<html><head><title>${title}</title></head><body>${body}</body></html>`;}
function ncx(entries) {return `<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>${entries.map(([title,href])=>`<navPoint><navLabel><text>${title}</text></navLabel><content src="${href}"/></navPoint>`).join('')}</navMap></ncx>`;}
function nav(entries) {return `<html><body><nav epub:type="toc"><ol>${entries.map(([title,href])=>`<li><a href="${href}">${title}</a></li>`).join('')}</ol></nav></body></html>`;}
module.exports = {makeBook,page,ncx,nav};
