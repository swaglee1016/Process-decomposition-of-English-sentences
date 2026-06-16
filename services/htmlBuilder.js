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
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

module.exports = {
  buildHeader,
  buildFooter,
  buildParagraphHtml,
  buildSentenceHtml,
  buildErrorHtml
};
