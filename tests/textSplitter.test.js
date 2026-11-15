const test = require('node:test');
const assert = require('node:assert/strict');
const { splitText } = require('../services/textSplitter');

function sentences(text) {
  const items = splitText(text);
  const result = [];
  let paragraph;
  for (const item of items) {
    if (item.type === 'paragraph') paragraph = item.text;
    if (item.type === 'sentence') {
      assert.equal(item.my_sentence, paragraph.slice(item.start, item.end));
      assert.ok(Number.isInteger(item.start) && Number.isInteger(item.end));
      assert.ok(item.start >= 0 && item.end <= paragraph.length && item.end > item.start);
      result.push(item.my_sentence);
    }
  }
  return { items, result };
}

test('only blank lines establish paragraphs; single line breaks become spaces', () => {
  const { items } = sentences('First.\nSecond sentence.\n\nHeading\n\nLast paragraph.');
  assert.deepEqual(items.filter(x => x.type === 'paragraph').map(x => x.text),
    ['First. Second sentence.', 'Heading', 'Last paragraph.']);
});

test('honors titles, abbreviations, initials and decimals inside a sentence', () => {
  const { result } = sentences('Mr. and Mrs. Smith met Dr. Jones and Prof. J. R. R. Tolkien at 3.14 p.m. They left.');
  assert.deepEqual(result, ['Mr. and Mrs. Smith met Dr. Jones and Prof. J. R. R. Tolkien at 3.14 p.m.', 'They left.']);
});

test('handles U.S. within and at the end of a sentence, and etc. at sentence end', () => {
  assert.deepEqual(sentences('The U.S. economy grew. Then it fell.').result,
    ['The U.S. economy grew.', 'Then it fell.']);
  assert.deepEqual(sentences('She visited the U.S. and Canada. Then returned.').result,
    ['She visited the U.S. and Canada.', 'Then returned.']);
  assert.deepEqual(sentences('He brought pens, etc. Then he left.').result,
    ['He brought pens, etc.', 'Then he left.']);
});

test('keeps closing straight and curly quotes and attribution with the utterance', () => {
  assert.deepEqual(sentences('“Go!” she said. "No." he replied. Next.').result,
    ['“Go!” she said.', '"No." he replied.', 'Next.']);
});

test('honorifics inside straight and curly quotation marks stay with the name', () => {
  assert.deepEqual(sentences('"Mr. Smith is here." Then we left.').result,
    ['"Mr. Smith is here."', 'Then we left.']);
  assert.deepEqual(sentences('“Mrs. Jones left.” Then we waited.').result,
    ['“Mrs. Jones left.”', 'Then we waited.']);
});

test('e.g. and i.e. inside a sentence do not create false boundaries', () => {
  assert.deepEqual(sentences('Use examples, e.g. apples and pears. Then explain, i.e. clarify.').result,
    ['Use examples, e.g. apples and pears.', 'Then explain, i.e. clarify.']);
});

test('keeps short sentences and an unterminated tail', () => {
  const { result } = sentences('Hi. No. Go! End without a period');
  assert.deepEqual(result, ['Hi.', 'No.', 'Go!', 'End without a period']);
});

test('St. place names and personal initials do not split a sentence', () => {
  const first = "In the novel, Twain renames Hannibal as St. Petersburg, thus suggesting, as John C. Gerber has said, St. Peter’s place, or heaven’s-But heaven, as Twain depicts it, is a real place.";
  assert.deepEqual(sentences(first + ' Many of the sites are identifiable.').result,
    [first, 'Many of the sites are identifiable.']);
  assert.deepEqual(sentences('We returned to St. Petersburg. Here, Tom waited.').result,
    ['We returned to St. Petersburg.', 'Here, Tom waited.']);
  assert.deepEqual(sentences('St. Louis and Mt. Everest were mentioned. Next.').result,
    ['St. Louis and Mt. Everest were mentioned.', 'Next.']);
});

test('sentence offsets are UTF-16 and preserve emoji and inter-sentence text', () => {
  const paragraph = '😀 Hi.  No.  Tail';
  const { items } = sentences(paragraph);
  const runs = items.filter(x => x.type === 'sentence');
  assert.deepEqual(runs.map(x => x.my_sentence), ['😀 Hi.', 'No.', 'Tail']);
  assert.deepEqual(runs.map(x => [x.start, x.end]), [[0, 6], [8, 11], [13, 17]]);
  assert.equal(paragraph.slice(0, runs[0].start) + runs.map((run, i) =>
    paragraph.slice(run.start, run.end) + paragraph.slice(run.end, runs[i + 1]?.start ?? paragraph.length)).join(''), paragraph);
});
