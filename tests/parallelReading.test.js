const test = require('node:test');
const assert = require('node:assert/strict');
const shared = require('../public/studyShared');
const html = require('../services/htmlBuilder');

test('continuous paragraphs keep repeated sentences matched without sentence rows', () => {
  const section = {paragraph:'Yes. Yes.',sentences:[
    {text:'Yes.',start:0,end:4,translation:'好的。'},
    {text:'Yes.',start:5,end:9,translation:'是的。'}
  ]};
  const markup = shared.buildParallelParagraph(section, 10);
  assert.match(markup, /class="parallel-paragraph"/);
  assert.match(markup, /class="sent-span"[^>]*data-section="10"/);
  assert.match(markup, /class="translation-text"[^>]*data-section="10"[^>]*>好的。/);
  assert.match(markup, /class="translation-text"[^>]*data-section="11"[^>]*>是的。/);
  assert.doesNotMatch(markup, /grid-row|<br\b/);
  const english = markup.match(/<div class="para-text">([\s\S]*?)<\/div>/)[1].replace(/<[^>]*>/g,'');
  assert.equal(english, section.paragraph);
  assert.equal((markup.match(/class="para-text"/g)||[]).length,1);
  assert.equal((markup.match(/class="translation-paragraph"/g)||[]).length,1);
});

test('paired reading retains unanalysed text and missing translations visibly', () => {
  const markup = shared.buildParallelParagraph({paragraph:'Preface. Known. Tail',sentences:[{text:'Known.'}]},0);
  assert.match(markup,/Preface\./);assert.match(markup,/Tail/);
  assert.match(markup,/暂无译文/);
  assert.equal((markup.match(/class="translation-text"/g)||[]).length,1);
});

test('model translation and source text remain escaped text, never executable markup', () => {
  const text = 'A < B.';
  const markup = shared.buildParallelParagraph({paragraph:text,sentences:[{text,translation:'</span><script>alert(1)</script>&'}]},0);
  assert.match(markup,/A &lt; B\./);
  assert.match(markup,/&lt;script&gt;alert\(1\)&lt;\/script&gt;&amp;/);
  assert.doesNotMatch(markup,/<script>/);
});

test('offline export embeds paired translation and the shared navigation without a server', () => {
  const page = html.buildCompleteStudyHtml([{paragraph:'Hello.',sentences:[{text:'Hello.',translation:'你好。',html:'<p>Diagram</p>'}]}]);
  assert.match(page,/class="translation-text"/);
  assert.match(page,/你好。/);
  assert.match(page,/StudyNavigation/);
  assert.doesNotMatch(page,/<script[^>]+src=|<link[^>]+stylesheet/);
});
