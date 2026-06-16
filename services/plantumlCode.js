/**
 * PlantUML 代码修正 — 迁移自 n8n "Code in JavaScript1" Code 节点
 *
 * 核心逻辑：
 * 1. 从 AI 回复中提取 JSON，解析 puml 字段
 * 2. %%% → \n 转换
 * 3. 自动换行（超过 40 字符强制断行）
 * 4. 语法修正（去加粗、确保单根节点、空行补星号）
 */

function parseAndFix(rawContent) {
  let content = rawContent || '';
  let pumlCode = '';

  // 1. 提取 JSON
  content = content.replace(/```(json|puml|plantuml)?/gi, '').replace(/```/g, '').trim();
  try {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      const parsed = JSON.parse(content.substring(start, end + 1));
      pumlCode = parsed.puml || content;
    } else {
      pumlCode = content;
    }
  } catch {
    pumlCode = content;
  }

  // 2. 转换 AI 的换行占位符
  pumlCode = pumlCode.replace(/%%%/g, '\\n');

  // 3. 自动换行函数
  function wrapText(str) {
    const parts = str.split('\\n');
    return parts.map(part => {
      if (part.length <= 40) return part;
      let remaining = part;
      const wrapped = [];
      while (remaining.length > 40) {
        let breakIdx = remaining.lastIndexOf(' ', 40);
        if (breakIdx <= 0) breakIdx = 40;
        wrapped.push(remaining.slice(0, breakIdx));
        remaining = remaining.slice(breakIdx).trim();
      }
      if (remaining) wrapped.push(remaining);
      return wrapped.join('\\n');
    }).join('\\n');
  }

  // 4. 语法修正
  const lines = pumlCode.split('\n');
  const newLines = [];
  let hasRoot = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('@') || trimmed.startsWith('scale') || trimmed.startsWith('left to')) {
      continue;
    }

    const match = trimmed.match(/^(\*+)\s*(.*)$/);
    if (match) {
      let stars = match[1];
      let text = match[2].trim();

      // 去掉 AI 乱加的 Markdown 加粗
      text = text.replace(/\*\*(.*?)\*\*/g, '$1');
      text = text.replace(/^[:，,]\s*/, '');

      if (!text) continue;

      // 确保只有一个根节点
      if (stars === '*') {
        if (hasRoot) stars = '**';
        hasRoot = true;
      } else if (!hasRoot) {
        stars = '*';
        hasRoot = true;
      }

      text = wrapText(text);
      newLines.push(`${stars} ${text}`);
    } else if (trimmed.length > 0) {
      // 没星号的行接到上一行后面
      if (newLines.length > 0) {
        newLines[newLines.length - 1] += '\\n' + wrapText(trimmed);
      }
    }
  }

  // 5. 组装最终代码
  return '@startmindmap\nscale 2\nleft to right direction\n' + newLines.join('\n') + '\n@endmindmap';
}

module.exports = { parseAndFix };
