const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAnalysis } = require('../services/orderedAnalysis');
const { buildUserPrompt, ANALYSIS_SYSTEM_PROMPT } = require('../services/deepseek');
const { renderDiagram } = require('../services/plantumlRenderer');

test('real SVG displays quotation marks as quotes rather than literal HTML entity names', async () => {
  const sentence = '"" Alice said "go".';
  const result = parseAnalysis({sentenceType:'简单句',translation:'爱丽丝说走吧。',grammarNotes:['引用 "go"'],parts:[
    {text:sentence,role:'主句',translation:'爱丽丝说走吧',details:[{text:'"go"',role:'引语',translation:'"走吧"'}]}
  ]},sentence);
  const diagram = await renderDiagram(result.code);
  assert.equal(diagram?.mimeType,'image/svg+xml');
  const visible = [...diagram.buffer.toString('utf8').matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map(match =>
    match[1].replace(/&#(\d+);|&(quot|apos|lt|gt|amp);/g, (_, number, name) => number ? String.fromCodePoint(Number(number)) : ({quot:'"',apos:"'",lt:'<',gt:'>',amp:'&'}[name]))
  ).join('\n');
  assert.doesNotMatch(visible,/&quot;|&#34;/);
  assert.ok(visible.includes('原文：' + sentence));
  assert.ok(visible.includes('引用 "go"'));
  assert.ok(visible.includes('引语："go"｜"走吧"'));
});

const parse = (sentence, parts, extra = {}) => parseAnalysis(JSON.stringify({
  sentenceType: '复合句', translation: '整句译文', grammarNotes: ['顺序说明'], parts, ...extra
}), sentence);
test('typographic quotes, dashes and whitespace differences retain original source spans',()=>{
  const source='“She can’t wait”—said Alice.  Bob left.';
  const result=parse(source,[{text:'"She can\'t wait"-said Alice.',role:'主句',translation:'她等不及了，爱丽丝说。'},{text:'Bob left.',role:'主句',translation:'鲍勃离开了。'}]);
  assert.equal(result.ordered[0].text,'“She can’t wait”—said Alice.');
  assert.equal(result.ordered[0].start,0);assert.equal(result.ordered[0].end,source.indexOf('  '));
  assert.throws(()=>parse('Alice waited.',[{text:'Alice departed.',role:'主句',translation:'爱丽丝离开'}]),/source|原文/);
  const emoji='😀 “She left.”';const mapped=parse(emoji,[{text:'😀 "She left."',role:'主句',translation:'她离开了。'}]);assert.equal(mapped.ordered[0].end,emoji.length);assert.equal(mapped.ordered[0].text,emoji);
});

test('punctuation-only parts and details never become boxes or consume numbering', () => {
  const source = 'Alice, Bob, or Carol left.';
  const result = parse(source, [
    {text:'Alice, Bob, or Carol',role:'主语',translation:'三人之一',details:[
      {text:'Alice',role:'并列项',translation:'爱丽丝'},
      {text:',',role:'标点',translation:','},
      {text:'Bob',role:'并列项',translation:'鲍勃'},
      {text:', or',role:'连词',translation:'或者'},
      {text:'Carol',role:'并列项',translation:'卡罗尔'}
    ]},
    {text:'left',role:'谓语',translation:'离开了'},
    {text:'.',role:'句末标点',translation:'.'}
  ]);
  assert.deepEqual(result.ordered.map(part => part.text), ['Alice, Bob, or Carol','left']);
  assert.deepEqual(result.ordered[0].details.map(detail => detail.text), ['Alice','Bob',', or','Carol']);
  assert.doesNotMatch(result.code, /标点|\*\* 3\.|\*\*\* 1\.5/);
  assert.match(result.code, /1\.3 连词：, or/);
  assert.match(result.code, /原文：Alice, Bob, or Carol left\./);
});

test('quotes, parentheses, dashes and ellipses are not standalone grammar components', () => {
  for (const punctuation of [',','.', ';', ':', '!', '?', '“', '”', '(', ')', '—', '…', '...', '，', '。']) {
    const source = `Go${punctuation}`;
    const result = parse(source, [
      {text:'Go',role:'谓语',translation:'走',details:[{text:'Go',role:'词',translation:'走'}]},
      {text:punctuation,role:'符号',translation:punctuation}
    ]);
    assert.equal(result.ordered.length,1,punctuation);
    assert.doesNotMatch(result.code,/\*\* 2\./);
  }
  const result = parse('Go.', [{text:'Go.',role:'谓语',translation:'走',details:[{text:'.',role:'标点',translation:'.'}]}]);
  assert.deepEqual(result.ordered[0].details,[]);
  assert.throws(() => parse('Go.', [{text:'.',role:'标点',translation:'.'}]), /parts|cover|source/);
});

test('punctuated words, numbers and semantic symbols are retained regardless of role name', () => {
  const source = "Mr. Lee can't pay $5.";
  const result = parse(source,[{text:source,role:'主句',translation:'李先生不能付五元',details:[
    {text:'Mr.',role:'称呼',translation:'先生'}, {text:"can't",role:'否定',translation:'不能'},
    {text:'$',role:'货币符号',translation:'美元'}, {text:'5',role:'数词',translation:'五'}
  ]}]);
  assert.deepEqual(result.ordered[0].details.map(detail=>detail.text),['Mr.',"can't",'$', '5']);
});

test('grammar notes share one box attached to the original sentence and full translation stays outside the diagram', () => {
  const result = parse('She left.', [{text:'She left.',role:'主句',translation:'她离开'}], {
    translation:'仅用于中间栏的整句译文', grammarNotes:['时态：一般过去时','固定搭配：无']
  });
  const lines = result.code.split('\n');
  const original = lines.findIndex(line => line.startsWith('** 原文：'));
  assert.equal(lines[original + 1], '*** 核心语法点：\\n时态：一般过去时\\n固定搭配：无');
  assert.equal(lines.filter(line => line.includes('核心语法点')).length, 1);
  assert.doesNotMatch(result.code, /语法提示：|整句翻译：|仅用于中间栏的整句译文/);
  assert.equal(result.translation, '仅用于中间栏的整句译文');
  assert.doesNotMatch(result.code, /\*+ 翻译：/);
});

test('short-clause translation branches are omitted while component glosses remain', () => {
  const result = parse('Alice said yes.', [{text:'Alice said yes.',role:'主句',translation:'独立短句译文',details:[
    {text:'Alice',role:'主语',translation:'爱丽丝'},
    {text:'said',role:'谓语',translation:'说'},
    {text:'yes',role:'宾语',translation:'是的'}
  ]}]);
  assert.doesNotMatch(result.code,/独立短句译文|\*+ 翻译[：:]/);
  assert.match(result.code,/1\.1 主语：Alice｜爱丽丝/);
  assert.match(result.code,/1\.2 谓语：said｜说/);
  assert.equal(result.translation,'整句译文');
  assert.equal(result.ordered[0].translation,'独立短句译文');
});

test('leaf parts include an inline Chinese gloss, including empty or punctuation-only details', () => {
  for (const details of [undefined, [], [{text:',',role:'标点',translation:','}]]) {
    const result = parse('Upon his return, Tom left.', [
      {text:'Upon his return,',role:'时间状语',translation:'在他回来后',details},
      {text:' Tom left.',role:'主句',translation:'汤姆离开了',details:[
        {text:'Tom',role:'主语',translation:'汤姆'},
        {text:'left',role:'谓语',translation:'离开了'}
      ]}
    ]);
    assert.match(result.code, /\*\* 1\. 时间状语：Upon his return,｜在他回来后/);
    assert.doesNotMatch(result.code, /\*\* 2\. 主句：[^\n]*｜汤姆离开了/);
    assert.match(result.code, /\*\*\* 2\.2 谓语：left｜离开了/);
  }
});

test('real local SVG displays an undecomposed phrase and its inline translation', async () => {
  const result = parse('Upon his return, Tom left.', [
    {text:'Upon his return,',role:'时间状语',translation:'在他回来后'},
    {text:' Tom left.',role:'主句',translation:'汤姆离开了',details:[
      {text:'Tom',role:'主语',translation:'汤姆'}, {text:'left',role:'谓语',translation:'离开了'}
    ]}
  ]);
  const diagram = await renderDiagram(result.code);
  assert.equal(diagram?.mimeType,'image/svg+xml');
  const visible = [...diagram.buffer.toString('utf8').matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)]
    .map(match => match[1].replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))).join('\n');
  assert.match(visible,/时间状语：Upon his return,｜在他回来后/);
  assert.match(visible,/谓语：left｜离开了/);
});

test('legacy short-clause translation branches are removed without losing following components', () => {
  const result=parseAnalysis('@startmindmap\n* 简单句\n** 主句：Alice said yes.\n*** 翻译：爱丽丝说是的\n*** 主语 Alice｜爱丽丝\n*** 谓语 said｜说\n@endmindmap','Alice said yes.');
  assert.doesNotMatch(result.code,/翻译：/);
  assert.match(result.code,/主语 Alice｜爱丽丝/);
  assert.match(result.code,/谓语 said｜说/);
});

test('fronted and inserted relative clauses retain source order in the diagram', () => {
  const sentence = 'When rain stopped, the book that she bought arrived today.';
  const parts = [
    { text: 'When rain stopped,', role: '时间从句', translation: '雨停后' },
    { text: ' the book ', role: '主句前段', translation: '那本书' },
    { text: 'that she bought', role: '定语从句', translation: '她买的' },
    { text: ' arrived today.', role: '主句后段', translation: '今天到了' }
  ];
  const result = parse(sentence, parts);
  assert.deepEqual(result.ordered.map(part => part.text), parts.map(part => part.text));
  assert.deepEqual(result.ordered.map(part => [part.start, part.end]), [[0, 18], [18, 28], [28, 43], [43, 58]]);
  const labels = ['时间从句', '主句前段', '定语从句', '主句后段'];
  assert.ok(labels.every((label, i) => result.code.indexOf(label) < result.code.indexOf(labels[i + 1] || '@endmindmap')));
  assert.equal(result.translation, '整句译文');
});

test('shuffled parts and details are located by source offsets, including repeated words', () => {
  const sentence = 'The man saw the man and smiled.';
  const result = parse(sentence, [
    { text: ' and smiled.', role: '后段', translation: '微笑', details: [{ text: 'smiled', role: '谓语', translation: '微笑' }, { text: 'and', role: '连接', translation: '并且' }] },
    { text: 'the man', role: '宾语', translation: '那个人' },
    { text: 'The man saw ', role: '前段', translation: '那个人看见' }
  ]);
  assert.deepEqual(result.ordered.map(part => part.role), ['前段', '宾语', '后段']);
  assert.equal(result.ordered[1].start, sentence.indexOf('the man'));
  assert.deepEqual(result.ordered[2].details.map(item => item.text), ['and', 'smiled']);
});

test('missing or invented source words reject the structured analysis', () => {
  assert.throws(() => parse('Alice saw Bob.', [
    { text: 'Alice', role: '主语', translation: '爱丽丝' },
    { text: 'Bob.', role: '宾语', translation: '鲍勃' }
  ]), /cover|source|原文/i);
  assert.throws(() => parse('Alice saw Bob.', [
    { text: 'Alice saw Eve.', role: '主句', translation: '错误' }
  ]), /source|原文/i);
});

test('missing translation, invalid details, and malformed schema fail explicitly', () => {
  assert.throws(() => parseAnalysis('{"parts":[]}', 'Go.'), /translation|schema|parts/i);
  assert.throws(() => parse('She left.', [{ text: 'She left.', role: '主句', translation: '她离开', details: [{ text: 'elsewhere', role: '谓语', translation: '其他' }] }]), /detail|source|原文/i);
});

test('model text cannot inject PlantUML directives, tags or new diagram lines', () => {
  const sentence = 'He said "go!"\nThen left <now>.';
  const result = parse(sentence, [{ text: sentence, role: '主句\n!include secret', translation: '<script>x</script> @enduml' }], {
    sentenceType: '@startuml\n!include attacker', grammarNotes: ['<img src=x>\n@endmindmap']
  });
  assert.equal(result.ordered[0].text, sentence);
  assert.equal(result.code.match(/^@startmindmap$/gm)?.length, 1);
  assert.equal(result.code.match(/^@endmindmap$/gm)?.length, 1);
  assert.doesNotMatch(result.code, /<script>|<img|^!include|^@startuml|^@enduml/gm);
  assert.match(result.code, /&lt;now&gt;/);
});

test('model labels cannot evaluate PlantUML functions or Creole formatting', () => {
  const text = '%chr(65) //italic// __bold__ --strike-- $name';
  const result = parse('Go.', [{text:'Go.',role:'主句',translation:text}], {translation:text,grammarNotes:[text]});
  assert.doesNotMatch(result.code, /%chr|\/\/italic\/\/|__bold__|--strike--|\$name/);
  assert.match(result.code,/&#37;chr\(65\)/);
  assert.match(result.code,/&#47;&#47;italic&#47;&#47;/);
});

test('legacy puml remains usable and extracts the Chinese translation when present', () => {
  const raw = JSON.stringify({ puml: '@startmindmap\n* 复合句\n** 中文翻译：她走了。%%%随后回来。\n@endmindmap' });
  const result = parseAnalysis(raw, 'She left.');
  assert.match(result.code, /@startmindmap/);
  assert.equal(result.translation, '她走了。随后回来。');
  assert.doesNotMatch(result.code, /中文翻译：/);
  assert.deepEqual(result.ordered, []);
  assert.equal(parseAnalysis(JSON.stringify({ puml: '@startmindmap\n* Test\n@endmindmap' }), 'Test.').translation, '');
});

test('analysis prompt requests source-ordered JSON and demonstrates ordinary and inserted clauses', () => {
  const prompt = buildUserPrompt('The book that I bought arrived.');
  assert.match(ANALYSIS_SYSTEM_PROMPT, /parts/);
  assert.match(ANALYSIS_SYSTEM_PROMPT, /translation/);
  assert.match(prompt, /The book that I bought arrived\./);
  assert.match(prompt, /示例一|例1/);
  assert.match(prompt, /示例二|例2/);
  assert.match(prompt, /定语从句/);
  assert.match(prompt, /顺序|依次/);
});

test('long English and Chinese labels wrap inside a trusted node', () => {
  const sentence = Array.from({ length: 18 }, (_, i) => `word${i}`).join(' ') + '.';
  const translation = '这是一句需要在图中分行展示的中文译文'.repeat(4);
  const result = parse(sentence, [{ text: sentence, role: '主句', translation }], { translation, grammarNotes:[translation] });
  assert.match(result.code, /word5\\nword6|word6\\nword7/);
  assert.doesNotMatch(result.code, /\*+ 翻译：/);
  assert.equal(result.code.match(/^\*\* 1\./gm)?.length, 1);
  const chineseLines = result.code.split('\n').find(line => line.startsWith('*** 核心语法点：')).split('\\n').slice(1);
  assert.ok(chineseLines.length > 1);
  assert.ok(chineseLines.every(line => [...line].length <= 24));
});

test('ambiguous repeated parts stop after bounded matching work', () => {
  const sentence = 'go '.repeat(8) + 'end.';
  const parts = Array.from({ length: 8 }, () => ({ text: 'go', role: '词', translation: '走' }));
  assert.throws(() => parse(sentence, parts), /search limit|搜索上限/i);
});
