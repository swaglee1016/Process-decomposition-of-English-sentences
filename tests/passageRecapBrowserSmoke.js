const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {createApp} = require('../server');
const {openBrowser} = require('./browserHarness');

async function main() {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'passage-recap-'));
  const modelInputs = [];
  const recap = [
    'What happens — A cyclist finds her way home.',
    '- Problem — She loses her map.',
    '- Outcome — She follows the river.'
  ].join('\n');
  const secondRecap = 'Main idea — Wind shapes dunes.';
  const app = createApp({
    outputDir, delayMs: 0,
    analyzeSentence: async text => ({
      sentenceType: '简单句', translation: '测试译文', parts: [{text, role:'主句', translation:'测试译文'}]
    }),
    renderDiagram: async () => null,
    recapModel: async (system, passage) => {
      modelInputs.push(passage);
      return passage.includes('dunes') ? secondRecap : recap;
    }
  });
  const server = app.listen(0,'127.0.0.1');
  await new Promise(resolve => server.once('listening',resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  async function stop() {
    if (server.listening) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    app.locals.closeVocabulary();
  }
  try {
    browser = await openBrowser();
    const {evaluate, until} = browser;
    await browser.navigate(origin);
    await until(() => evaluate('typeof renderSections === "function"'));
    async function processPassage(source) {
      await evaluate('paragraphMode.value="preserve"; textInput.value=' + JSON.stringify(source) + ';textInput.dispatchEvent(new Event("input"));processBtn.click()');
      await until(() => evaluate('!!preview && !busy'));
      await evaluate('analyzeBtn.click()');
      await until(() => evaluate('!busy && statusText.textContent.startsWith("完成：")'));
    }
    await processPassage('The cyclist lost her map. She followed the river home.');
    const outputUrl = await evaluate('outputUrl');
    assert.equal((await fetch(new URL(outputUrl,origin))).status, 200);
    assert.equal(modelInputs.length, 0, 'opening a reading result must not request a recap');
    assert.equal(await evaluate('document.querySelector("#readingFocusButton")?.nextElementSibling?.id'), 'passageRecapButton');
    async function openRecap(expected = recap) {
      await evaluate('document.querySelector("#passageRecapButton").click()');
      const [lead, ...points] = expected.split('\n');
      const [leadLabel, leadText] = lead.split(' — ');
      await until(() => evaluate('document.querySelector("dialog[open]")?.innerText.includes(' + JSON.stringify(leadText) + ')'));
      const displayed = await evaluate(`(() => {
        const dialog = document.querySelector("dialog[open]");
        return {
          lead: dialog.querySelector("strong")?.innerText,
          points: [...dialog.querySelectorAll("ul > li")].map(item => item.innerText)
        };
      })()`);
      assert.ok(displayed.lead?.includes(leadLabel) || displayed.lead?.includes(leadText), 'the lead must be emphasized');
      assert.equal(displayed.points.length, points.length, 'one list item per source-grounded point');
      points.forEach((point, index) => {
        const [label, detail] = point.slice(2).split(' — ');
        assert.ok(displayed.points[index].includes(label) && displayed.points[index].includes(detail));
      });
    }
    await openRecap();
    assert.equal(modelInputs.length, 1);
    assert.match(modelInputs[0], /The cyclist lost her map/);
    assert.match(modelInputs[0], /She followed the river home/);
    await evaluate('document.querySelector("dialog[open]").close()');
    await openRecap();
    assert.equal(modelInputs.length, 1, 'reopening should reuse the generated recap');
    await evaluate('document.querySelector("dialog[open]").close()');
    await processPassage('Wind shapes the dunes.');
    assert.equal(modelInputs.length, 1, 'a new passage also waits for an explicit click');
    await openRecap(secondRecap);
    assert.equal(modelInputs.length, 2);
    assert.doesNotMatch(modelInputs[1], /cyclist/);
    await stop();
    const savedPath = path.join(outputDir,path.basename(outputUrl));
    await browser.navigate(pathToFileURL(savedPath).href);
    await until(() => evaluate('location.protocol === "file:" && !!document.querySelector("#passageRecapButton")'));
    const before = browser.requests.length;
    await openRecap();
    assert.equal(browser.requests.slice(before).some(url => /^https?:/.test(url)), false);
    const olderText = 'The rider finds her way home by following the river.';
    const savedHtml = await fs.readFile(savedPath, 'utf8');
    const legacySlot = '<script type="application/json" id="passageRecapData">' + JSON.stringify(recap) + '</script>';
    assert.ok(savedHtml.includes(legacySlot), 'the canonical recap is embedded in the saved page');
    const legacyPath = path.join(outputDir, 'legacy-recap-fixture.html');
    await fs.writeFile(legacyPath, savedHtml.replace(legacySlot, legacySlot.replace(JSON.stringify(recap), JSON.stringify(olderText))));
    await browser.navigate(pathToFileURL(legacyPath).href);
    await until(() => evaluate('location.pathname.endsWith("legacy-recap-fixture.html") && !!document.querySelector("#passageRecapButton")'));
    await evaluate('document.querySelector("#passageRecapButton").click()');
    await until(() => evaluate('document.querySelector("dialog[open]")?.innerText.includes(' + JSON.stringify(olderText) + ')'));
    assert.equal(browser.requests.slice(before).some(url => /^https?:/.test(url)), false);
    assert.deepEqual(browser.errors, []);
    console.log('Passage recap browser acceptance passed: on-demand structured live and offline recaps, passage isolation, cached reuse, and readable legacy text.');
  } finally {
    await browser?.close();
    await stop();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
