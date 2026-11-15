// Local renderer and HTTP acceptance: synthetic text, no external model calls.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server');
const { renderDiagram, renderToPng } = require('../services/plantumlRenderer');

async function main() {
  const examples = [
    {
      text: 'Miss Carter, who had already checked the report twice before the meeting began, said that the team could submit it today.',
      sentenceType: '复合句', translation: '卡特小姐在会议开始前已经检查过报告两次，她说团队今天可以提交报告。',
      grammarNotes: ['固定搭配：check the report 检查报告；submit it 提交报告', '特殊语法：who 引导非限制性定语从句；that 引导宾语从句', '时态与语态：had checked 过去完成时；said 一般过去时；主动语态', '情态动词：could 表示能力或许可'],
      parts: [
        { text: 'Miss Carter,', role: '主句主语', translation: '卡特小姐' },
        { text: 'who had already checked the report twice before the meeting began,', role: '定语从句', translation: '会议开始前已经检查报告两次' },
        { text: 'said', role: '主句谓语', translation: '说' },
        { text: 'that the team could submit it today.', role: '宾语从句', translation: '团队今天可以提交报告' }
      ]
    },
    {
      text: '"The book that I bought arrived."', sentenceType: '复合句', translation: '“我买的书到了。”',
      grammarNotes: ['特殊语法：that I bought 是修饰 book 的定语从句', '时态与语态：一般过去时，主动语态'],
      parts: [
        { text: '"The book', role: '主句主语', translation: '这本书' },
        { text: 'that I bought', role: '定语从句', translation: '我买的' },
        { text: 'arrived."', role: '主句谓语', translation: '到了' }
      ]
    }
    ,{
      text: 'Alice, Bob, or Carol left.', sentenceType: '简单句', translation: '爱丽丝、鲍勃或卡罗尔离开了。',
      grammarNotes: ['or 连接并列主语；left 是一般过去时'],
      parts: [
        {text:'Alice, Bob, or Carol',role:'主语',translation:'爱丽丝、鲍勃或卡罗尔',details:[
          {text:'Alice',role:'并列项',translation:'爱丽丝'},
          {text:',',role:'标点',translation:','},
          {text:'Bob',role:'并列项',translation:'鲍勃'},
          {text:', or',role:'连词',translation:'或者'},
          {text:'Carol',role:'并列项',translation:'卡罗尔'}
        ]},
        {text:'left',role:'谓语',translation:'离开了'},
        {text:'.',role:'句末标点',translation:'.'}
      ]
    }
  ];
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'grammar-layout-'));
  const codes = [];
  const server = createApp({ delayMs: 0,
    analyzeSentence: async text => {
      const example = examples.find(item => item.text === text);
      assert.ok(example); return JSON.stringify(example);
    },
    renderDiagram: async code => {
      codes.push(code);
      const diagram = await renderDiagram(code);
      assert.equal(diagram?.mimeType, 'image/svg+xml');
      const svg = diagram.buffer.toString('utf8');
      const texts = [...svg.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)].map(match => ({
        text: match[2].replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number(value))), x: Number(match[1].match(/\bx="([^"]+)"/)[1]),
        y: Number(match[1].match(/\by="([^"]+)"/)[1])
      }));
      const original = texts.find(item => item.text.startsWith('原文：'));
      const grammar = texts.find(item => item.text.startsWith('核心语法点：'));
      const firstPart = texts.find(item => item.text.startsWith('1. '));
      assert.ok(original && grammar && firstPart);
      assert.ok(grammar.x > original.x && grammar.y < firstPart.y, 'Grammar must be to the upper right of the ordered branches');
      assert.doesNotMatch(texts.map(item => item.text).join('\n'), /翻译：|语法提示：|标点：/);
      if (code.includes('Alice, Bob')) {
        assert.match(code, /1\.3 连词：, or/);
        assert.doesNotMatch(code, /\*\* 3\.|\*\*\* 1\.5/);
      }
      return diagram;
    }
  }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  let filename;
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const events = await fetch(base + '/api/process', { method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({text: examples.map(item => item.text).join(' '), reviewed: true}) }).then(response => response.text());
    const complete = events.match(/event: complete\ndata: (.+)/); assert.ok(complete);
    const result = await fetch(base + '/api/result/' + JSON.parse(complete[1]).resultId).then(response => response.json());
    assert.equal(codes.length, examples.length);
    assert.equal((result.html.match(/class="diagram-canvas"/g) || []).length, examples.length);
    assert.ok(result.html.includes(examples[0].translation));
    assert.equal((await fetch(base + result.outputUrl)).status, 200);
    filename = path.resolve(__dirname, '../outputs', result.filename);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  assert.match(await fs.readFile(filename, 'utf8'), /class="translation-text"/);
  const preview = path.join(directory, 'grammar-layout.png');
  const png = await renderToPng(codes[0]); assert.ok(png);
  await fs.writeFile(preview, png);
  console.log(JSON.stringify({status: 'PASS', filename, preview, serverStopped: true, externalModelRequests: 0}));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
