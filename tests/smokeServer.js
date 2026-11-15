// Local application smoke harness: synthetic model, real local Java renderer.
// Never sends article text outside; no renderer dependency injection.
// Temporary output directory holds retained test HTML and is never auto-deleted.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createApp} = require('../server');
const {prepareParagraphs} = require('../services/paragraphSplitter');
const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentence-browser-smoke-'));
const app = createApp({outputDir, delayMs:0,
  prepareParagraphs:(raw,options)=>prepareParagraphs(raw,{...options,callModel:async()=>'{"breakAfter":[]}'}),
  analyzeSentence:async()=>JSON.stringify({puml:'@startmindmap\n* Synthetic sentence analysis\n** Main clause\n*** Subject: Mr. Smith\n*** Predicate: explained\n*** Object: the detailed proposal\n** Relative clause\n*** Additional information about the proposal and its practical implementation\n** Adverbial clause\n*** Context describing when the team reviewed the document\n@endmindmap'})
});
const server = app.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${server.address().port}`,outputDir,pid:process.pid})));
