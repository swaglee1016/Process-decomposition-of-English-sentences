/**
 * AI 智能段落拆分 — 在 textSplitter 之前预处理
 *
 * PDF/复制文本每行末尾都有硬换行，导致基于"句号+换行"的分段逻辑误切。
 * 先用 DeepSeek 按语义重排段落（段落间双换行），再交给 textSplitter 分句。
 */

const { callDeepSeek } = require('./deepseek');

const PARA_SYSTEM = `你是一个文本格式化工具。你的唯一任务是将文本按原作者的段落意图重新分段。
规则：
1. 保持原文每个句子原封不动，不要改写、删减、翻译
2. 只要不是原作者明显换段落的地方，就把换行当假换行缝合
3. 只有话题场景/人物视角发生明确转换时，才分新段落
4. 段落内句子用空格连接，段落间用双换行分隔
5. 只输出重排后的纯文本，不要加任何解释、标记`;

async function aiReparagraph(rawText) {
  const userPrompt = `将以下文本按原作者的段落意图重新分段。注意：文本中的换行是PDF复制产生的假换行，不是真正的段落边界。只有话题发生明确转换时才分新段落。段落间用空行分隔。\n\n${rawText}`;

  const result = await callDeepSeek(PARA_SYSTEM, userPrompt, 0, 30000);
  return result.trim();
}

module.exports = { aiReparagraph };
