const test = require('node:test');
const assert = require('node:assert/strict');
const { prepareParagraphs } = require('../services/paragraphSplitter');

test('preserve mode keeps each nonempty input line and never calls the model', async () => {
  const result = await prepareParagraphs('One line.\nSecond line.\n\nThird line.', {
    mode: 'preserve', callModel: () => { throw new Error('must not call'); }
  });
  assert.deepEqual(result, {
    text: 'One line.\n\nSecond line.\n\nThird line.',
    paragraphs: ['One line.', 'Second line.', 'Third line.'], warnings: []
  });
});

test('PDF model only returns sentence boundary indices and cannot rewrite words', async () => {
  let prompt;
  const result = await prepareParagraphs('First line of a\nlong sentence. Next sentence.\nNew thought starts\nhere.', {
    callModel: (_system, user) => { prompt = user; return JSON.stringify({ breakAfter: [1] }); }
  });
  assert.match(prompt, /0:/);
  assert.deepEqual(result.paragraphs, ['First line of a long sentence. Next sentence.', 'New thought starts here.']);
  assert.deepEqual(result.warnings, []);
});

test('PDF hard boundaries keep blank lines, short headings and standalone dialogue', async () => {
  const result = await prepareParagraphs('Title\n\nFirst line\nsecond line.\n“Hello!”\nNext line\ncontinues here.', {
    callModel: () => JSON.stringify({ breakAfter: [] })
  });
  assert.deepEqual(result.paragraphs, ['Title', 'First line second line. “Hello!” Next line continues here.']);
});

test('a short heading remains separate even without a blank line', async () => {
  const result = await prepareParagraphs('Chapter One\nThe story starts\non this page.', {
    callModel: () => JSON.stringify({ breakAfter: [] })
  });
  assert.deepEqual(result.paragraphs, ['Chapter One', 'The story starts on this page.']);
});

test('ordinary title-case and single-letter PDF wraps remain model decisions', async () => {
  const result = await prepareParagraphs('The Old Man\nwalked home.\nI\nam tired.', {
    callModel: () => JSON.stringify({ breakAfter: [] })
  });
  assert.deepEqual(result.paragraphs, ['The Old Man walked home. I am tired.']);
});

test('a quoted line within narration is not a forced paragraph', async () => {
  let systemPrompt;
  const result = await prepareParagraphs('She paused.\n“Hello.”\nThen she smiled.', {
    callModel: (system) => { systemPrompt = system; return JSON.stringify({ breakAfter: [] }); }
  });
  assert.deepEqual(result.paragraphs, ['She paused. “Hello.” Then she smiled.']);
  assert.match(systemPrompt, /引语|对话/);
  assert.match(systemPrompt, /空行/);
});

test('explicitly labelled alternating dialogue turns are protected', async () => {
  const result = await prepareParagraphs('Alice: “Hello.”\nBob: “Goodbye.”', {
    callModel: () => JSON.stringify({ breakAfter: [] })
  });
  assert.deepEqual(result.paragraphs, ['Alice: “Hello.”', 'Bob: “Goodbye.”']);
});

test('invalid model JSON, out-of-range and duplicate boundaries fall back with a warning', async () => {
  for (const reply of ['not JSON', '{"breakAfter":[-1]}', '{"breakAfter":[0,0]}', '{"breakAfter":[1.5]}', '{"text":"rewritten"}']) {
    const result = await prepareParagraphs('First sentence.\nSecond sentence.', { callModel: () => reply });
    assert.deepEqual(result.paragraphs, ['First sentence. Second sentence.']);
    assert.ok(result.warnings.some(x => /模型|分段/.test(x)));
  }
});

test('PDF text with no newlines can be separated at semantic and dialogue boundaries', async () => {
  const parts = ['Mr. Smith arrived. "Hello," he said.', '"Goodbye," she replied.', 'The next morning they travelled home.'];
  const result = await prepareParagraphs(parts.join(' '), {
    callModel: () => '{"breakAfter":[1,2]}'
  });
  assert.deepEqual(result.paragraphs, parts);
  assert.deepEqual(result.warnings, []);
});

test('PDF wraps do not change the available sentence boundaries', async () => {
  const source = 'Mrs. Jones waited for Mr. Smith. They went home together. The next day she returned.';
  const options = { callModel: () => '{"breakAfter":[1]}' };
  const plain = await prepareParagraphs(source, options);
  const wrapped = await prepareParagraphs(source.replaceAll(' ', '\n'), options);
  assert.deepEqual(wrapped.paragraphs, plain.paragraphs);
  assert.deepEqual(plain.paragraphs, ['Mrs. Jones waited for Mr. Smith. They went home together.', 'The next day she returned.']);
});

test('explicit speaker changes in one pasted line remain separate without AI', async () => {
  const result = await prepareParagraphs('Alice: “Hello.” Bob: “Goodbye.”', {
    callModel: () => '{"breakAfter":[]}'
  });
  assert.deepEqual(result.paragraphs, ['Alice: “Hello.”', 'Bob: “Goodbye.”']);
});

test('a multi-sentence quotation and its attribution stay together', async () => {
  const speech = '"Please wait. I need to speak to Mrs. Jones," he said.';
  const result = await prepareParagraphs(`${speech} The next morning the train arrived.`, {
    callModel: () => '{"breakAfter":[0]}'
  });
  assert.deepEqual(result.paragraphs, [speech, 'The next morning the train arrived.']);
});

test('an uppercase speaker attribution remains attached to its quotation', async () => {
  const speech = '“Are you ready?” Mrs. Jones asked.';
  const result = await prepareParagraphs(`${speech} The next morning the train arrived.`, {
    callModel: () => '{"breakAfter":[0]}'
  });
  assert.deepEqual(result.paragraphs, [speech, 'The next morning the train arrived.']);
});

test('curly single-quoted speech keeps internal sentences and contractions together', async () => {
  const speech = '‘Please wait. I don’t know,’ Mrs. Jones replied.';
  const result = await prepareParagraphs(`${speech} The next morning the train arrived.`, {
    callModel: () => '{"breakAfter":[0]}'
  });
  assert.deepEqual(result.paragraphs, [speech, 'The next morning the train arrived.']);
});

test('character-heavy sentences beyond one model window do not merge into a giant paragraph', async () => {
  const first = 'a'.repeat(7000) + '.', second = 'b'.repeat(7000) + '.';
  const result = await prepareParagraphs(first + ' ' + second, { callModel: () => '{"breakAfter":[]}' });
  assert.deepEqual(result.paragraphs, [first, second]);
  assert.ok(result.warnings.length > 0);
});

test('long merged articles get readable paragraphs even if AI fails or returns no breaks', async () => {
  const sentences = Array.from({ length: 42 }, (_, i) => `Scene ${i} described how the family travelled together through the town and arrived safely at home.`);
  const source = sentences.join(' ');
  for (const callModel of [() => '{"breakAfter":[]}', () => { throw new Error('unavailable'); }]) {
    const result = await prepareParagraphs(source, { callModel });
    assert.ok(result.paragraphs.length >= 4);
    assert.equal(result.paragraphs.join(' '), source);
    assert.ok(result.paragraphs.every(p => p.split(/\s+/).length <= 180));
    assert.ok(result.paragraphs.every(p => p.endsWith('home.')));
    assert.ok(result.warnings.some(w => /超长|阅读/.test(w)));
  }
});

test('long chapters use bounded model windows and still allow a boundary near the end', async () => {
  const sentences = Array.from({ length: 190 }, (_, i) => `Scene ${i} ended quietly.`);
  const seen = new Set();
  let calls = 0;
  const result = await prepareParagraphs(sentences.join(' '), { callModel: (_system, user) => {
    calls++;
    assert.ok(user.length < 15000, 'model window must stay bounded');
    const rows = [...user.matchAll(/^(\d+): (.*)$/gm)];
    assert.ok(rows.length <= 80, 'sentence window must stay bounded');
    const breakAfter = [];
    for (const [row, index, text] of rows) {
      const scene = Number(text.match(/Scene (\d+)/)?.[1]);
      seen.add(scene);
      if (scene === 187 && Number(index) < rows.length - 1) breakAfter.push(Number(index));
    }
    return JSON.stringify({ breakAfter });
  }});
  assert.ok(calls > 1);
  assert.equal(seen.size, 190);
  assert.equal(result.paragraphs.join(' '), sentences.join(' '));
  assert.equal(result.paragraphs.at(-1), sentences.slice(188).join(' '));
});

test('preserve mode warns when a pasted article has no usable paragraph breaks', async () => {
  const source = 'They waited in the hall. '.repeat(50).trim();
  const result = await prepareParagraphs(source, { mode: 'preserve', callModel: () => { throw new Error('must not call'); } });
  assert.deepEqual(result.paragraphs, [source]);
  assert.ok(result.warnings.some(w => /保留|PDF/.test(w)));
});

test('model failure conservatively joins uncertain PDF lines and preserves punctuation and hyphens', async () => {
  const result = await prepareParagraphs('well-being is\nimportant. Also, it\nmatters.', {
    callModel: () => { throw new Error('network down'); }
  });
  assert.deepEqual(result.paragraphs, ['well-being is important. Also, it matters.']);
  assert.ok(result.warnings.length > 0);
});
