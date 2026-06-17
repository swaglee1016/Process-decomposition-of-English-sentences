require('dotenv').config();

const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { splitText } = require('./services/textSplitter');
const { aiReparagraph } = require('./services/paragraphSplitter');
const { analyzeSentence } = require('./services/deepseek');
const { parseAndFix } = require('./services/plantumlCode');
const { renderToPng } = require('./services/plantumlRenderer');
const html = require('./services/htmlBuilder');

const app = express();
const PORT = process.env.PORT || 3000;

const upload = multer({ dest: 'uploads/' });

// 保险箱：存最终 HTML，定时清理
const resultStore = new Map();
const RESULT_TTL = 10 * 60 * 1000; // 10 分钟过期
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of resultStore) {
    if (now - entry.time > RESULT_TTL) resultStore.delete(id);
  }
}, 60000);

app.use(express.static('public'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 安全写 SSE — 包 try/catch
function sse(res, event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  try {
    res.write(payload);
  } catch (e) {
    console.error(`SSE write failed for event ${event}:`, e.message);
  }
}

// POST /api/process
app.post('/api/process', upload.single('file'), async (req, res) => {
  console.log('=== /api/process started ===');
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();

  let article = '';

  try {
    // 1. 获取文本
    if (req.file) {
      const ext = path.extname(req.file.originalname).toLowerCase();
      if (ext === '.pdf') {
        const pdfParse = require('pdf-parse');
        const dataBuffer = fs.readFileSync(req.file.path);
        const data = await pdfParse(dataBuffer);
        article = data.text;
      } else {
        article = fs.readFileSync(req.file.path, 'utf-8');
      }
      fs.unlink(req.file.path, () => {});
    } else if (req.body.text) {
      article = req.body.text;
    } else {
      sse(res, 'error', { message: '请提供文本或上传文件' });
      res.end();
      return;
    }

    if (!article.trim()) {
      sse(res, 'error', { message: '文本内容为空' });
      res.end();
      return;
    }

    console.log(`Input length: ${article.length} chars`);

    // 2. AI 智能分段：修复 PDF 复制文本的假换行问题
    sse(res, 'progress', { step: 'ai_para', message: 'AI 正在按语义智能分段...' });
    try {
      article = await aiReparagraph(article);
      console.log(`AI reparagraphed: ${article.length} chars`);
    } catch (err) {
      console.warn('AI 分段失败，用原始文本继续:', err.message);
      // 降级：用原始文本继续
    }

    // 3. 拆分段落和句子
    sse(res, 'progress', { step: 'split', message: '正在拆分段落和句子...' });
    const items = splitText(article);
    const paragraphs = items.filter(i => i.type === 'paragraph');
    const sentences = items.filter(i => i.type === 'sentence');

    console.log(`Split: ${paragraphs.length} paragraphs, ${sentences.length} sentences`);
    sse(res, 'progress', {
      step: 'split',
      message: `拆分完成：${paragraphs.length} 个段落，${sentences.length} 个句子`,
      paragraphs: paragraphs.length,
      sentences: sentences.length
    });

    // 3. 按原始顺序构建 sections + fullHtml
    const sections = [];
    let currentSection = null;
    let sentenceIndex = 0;

    // 句子间微延迟，防 API 限流
    const delayMs = 300;

    for (const item of items) {
      if (item.type === 'paragraph') {
        currentSection = { paragraph: item.text, sentences: [] };
        sections.push(currentSection);
      } else {
        sentenceIndex++;
        if (sentenceIndex > 1 && delayMs > 0) {
          await new Promise(r => setTimeout(r, delayMs));
        }

        const sentText = item.my_sentence.substring(0, 50);
        console.log(`[${sentenceIndex}/${sentences.length}] analyzing: ${sentText}`);

        sse(res, 'progress', {
          step: 'sentence',
          current: sentenceIndex,
          total: sentences.length,
          text: item.my_sentence.substring(0, 80) + (item.my_sentence.length > 80 ? '...' : ''),
          status: 'analyzing'
        });

        let cardHtml;
        let retries = 2;
        while (retries >= 0) {
          try {
            const rawContent = await analyzeSentence(item.my_sentence);
            const pumlCode = parseAndFix(rawContent);

            sse(res, 'progress', {
              step: 'sentence',
              current: sentenceIndex,
              total: sentences.length,
              text: item.my_sentence.substring(0, 80) + (item.my_sentence.length > 80 ? '...' : ''),
              status: 'rendering'
            });

            const pngBuffer = await renderToPng(pumlCode);

            if (pngBuffer) {
              cardHtml = html.buildSentenceHtml(item.my_sentence, pngBuffer.toString('base64'), 'image/png');
              console.log(`[${sentenceIndex}/${sentences.length}] OK (${pngBuffer.length} bytes PNG)`);
            } else {
              cardHtml = html.buildErrorHtml(item.my_sentence);
              console.log(`[${sentenceIndex}/${sentences.length}] PlantUML render failed, using error card`);
            }
            break; // 成功，跳出重试循环
          } catch (err) {
            console.error(`[${sentenceIndex}/${sentences.length}] attempt ${3 - retries}/3 ERROR:`, err.message);
            if (retries > 0) {
              const waitMs = 2000 * Math.pow(2, 2 - retries); // 2s, 4s
              console.log(`  retrying after ${waitMs}ms...`);
              await new Promise(r => setTimeout(r, waitMs));
              retries--;
            } else {
              cardHtml = html.buildErrorHtml(item.my_sentence);
              retries--;
            }
          }
        }

        if (currentSection) {
          currentSection.sentences.push({ text: item.my_sentence, html: cardHtml });
        }
      }
    }

    // 4. 从 sections 合成完整 HTML（用于下载）
    let fullHtml = html.buildHeader();
    for (const s of sections) {
      fullHtml += html.buildParagraphHtml(s.paragraph);
      for (const sent of s.sentences) {
        fullHtml += sent.html;
      }
    }
    fullHtml += html.buildFooter();
    console.log(`HTML built: ${fullHtml.length} chars`);

    // 5. 存入保险箱
    const resultId = crypto.randomUUID();
    resultStore.set(resultId, { html: fullHtml, sections, time: Date.now() });
    console.log(`Result stored with ID: ${resultId}`);

    // 6. SSE 只发轻量 ID + sections（不含图片 base64，客户端通过 result API 获取）
    sse(res, 'complete', { resultId });

  } catch (err) {
    console.error('FATAL process error:', err);
    sse(res, 'error', { message: err.message || '处理失败' });
  }

  res.end();
  console.log('=== /api/process finished ===');
});

// GET /api/result/:id — 返回完整 HTML 和结构化 sections
app.get('/api/result/:id', (req, res) => {
  const entry = resultStore.get(req.params.id);
  if (!entry) {
    return res.status(404).json({ error: '结果已过期或不存' });
  }
  res.json({ html: entry.html, sections: entry.sections });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
