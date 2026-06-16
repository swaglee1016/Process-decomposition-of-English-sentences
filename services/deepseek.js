/**
 * DeepSeek API 调用 — 迁移自 n8n "AI-deepseek1" HTTP Request 节点
 */

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';

const SYSTEM_PROMPT = `你是一个 PlantUML 专家。请将句子转换为思维导图。

⚠️ **核心技术规则（必须遵守）：**
1. **文本换行专用符（最高优先级）**：凡是需要在节点内部进行文字换行（如长句断句），请**绝对不要**直接用 \\n，必须使用特殊占位符 %%% 代替。🚨**强制规定：英文节点内容每 5-7 个单词必须无条件插入一次 %%% ，严禁生成单行长句！**
2. **结构换行**：不同的节点（即以 * 开头的行）之间，请正常使用 JSON 的 \\n 换行。
3. **左分右结构**：必须包含 left to right direction。而且合理分配从左到右的节点数，最好不要超过四个。
4. 仅输出 JSON 对象：{"puml": "..."}。`;

function buildUserPrompt(sentence) {
  return `分析句子：${sentence}

输出要求：
1.  第一层写明句型种类（如：简单句、并列句、复合句等）。
2. 第二层是对【原英文句子】的分析，必须完整。
    👉 **关键（必须执行）：原英文句子绝对不允许超过 7 个单词不换行！每 5-7 个单词之间【必须强制】插入 %%% 进行换行，保持方块状，严禁出现长条状的单行文本！**
3. 同级节点包含【中文翻译】，翻译过长也【强制】用 %%% 换行。
4. 语法分析（主句/从句/主语/谓语）按层级展开。
5. 在原句节点下挂载【核心语法点】（固定搭配用【】）。
6. 节点内容中不要用逗号或冒号作为开头。

输出范例：
{
  "puml": "@startmindmap\\nleft to right direction\\n* 主从复合\\n** 完整英文句子：Much as we%%%may pride ourselves on our good taste,%%%we are no longer free to choose the things we want,%%%for advertising exerts a subtle influence on us.\\n*** 核心语法点：%%%固定搭配：【Much as】 (虽然，尽管)、【pride oneself on】 (以...为傲)%%%【no longer】 (不再)、【exert an influence on】 (对...施加影响)%%%特殊语法：让步状语从句、原因状语从句、定语从句%%%时态与语态：主句和从句均使用一般现在时，表示普遍现象；主动语态%%%介词释义：on (关于，在...方面)、to (表动作对象)、on (对...)\\n** 中文翻译：纵然我们对自己的鉴赏力信心满满，%%%实则早已无法随心所欲地选择所需之物，%%%这皆是广告潜移默化之功。\\n** 让步状语\\n*** 引导词 Much as 尽管\\n*** 主语 we 我们\\n*** 谓语 may pride 可能以...为傲\\n*** 宾语 ourselves 我们自己\\n*** 状语 on our good taste 在我们的好品味方面\\n** 主句\\n*** 主语 we 我们\\n*** 系动词 are 是\\n*** 表语 no longer free 不再自由\\n*** 状语 to choose the things we want%%%去选择我们想要的东西（不定式短语表方面）\\n**** 定语从句 (修饰the things) we want 我们想要的\\n** 原因状语\\n*** 引导词 for 因为\\n*** 主语 advertising 广告\\n*** 谓语 exerts 施加\\n*** 宾语 a subtle influence 一种微妙的影响\\n*** 状语 on us 对我们\\n@endmindmap"
}`;
}

async function analyzeSentence(sentence) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);

  try {
    const response = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        temperature: 0.1,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(sentence) }
        ]
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`DeepSeek API ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    return content;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { analyzeSentence };
