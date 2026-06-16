/**
 * 文本拆分服务 — 迁移自 n8n "split paragraph" Code 节点
 *
 * 核心逻辑：
 * 1. 统一换行符
 * 2. 找句号/问号/叹号/右引号 + 换行 → 标记为真段落分界
 * 3. 剩余换行 → 空格（缝合 PDF/OCR 假换行）
 * 4. Intl.Segmenter 智能分句
 */

function splitText(article) {
  // 兼容多种输入：article / text / content 字段，或纯字符串
  if (typeof article === 'object') {
    article = article.article || article.text || article.content || '';
  }
  if (!article || typeof article !== 'string') {
    article = String(article || '');
  }

  // 1. 统一换行符
  let cleanText = article.replace(/\r\n/g, '\n');

  // 2. 句号/问号/叹号/右引号 + 换行 → 真段落分界标记
  cleanText = cleanText.replace(/([.?!]["”']?)\s*\n+/g, '$1%%%PARA%%%');

  // 3. 剩余换行 → 空格（缝合假换行）
  cleanText = cleanText.replace(/\n/g, ' ');

  // 4. 清理连续空格
  cleanText = cleanText.replace(/\s{2,}/g, ' ');

  // 5. 按真段落分界切分
  const paragraphs = cleanText.split('%%%PARA%%%').filter(p => p.trim().length > 0);

  // 6. 对每个段落用 Intl.Segmenter 智能分句
  const items = [];
  const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });

  for (const p of paragraphs) {
    items.push({
      type: 'paragraph',
      text: p.trim()
    });

    const segments = segmenter.segment(p);
    for (const seg of segments) {
      const clean = seg.segment.trim();
      if (clean.length > 5) {
        items.push({
          type: 'sentence',
          my_sentence: clean
        });
      }
    }
  }

  return items;
}

module.exports = { splitText };
