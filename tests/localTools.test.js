const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveLocalTools } = require('../services/plantumlRenderer');

test('discovers the newest installed PlantUML extension without configuring the system', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plantuml-discovery-'));
  for (const version of ['2.9.0', '2.18.1']) {
    const dir = path.join(homeDir, '.vscode', 'extensions', `jebbs.plantuml-${version}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'plantuml.jar'), 'fixture');
  }
  const tools = resolveLocalTools({ homeDir, env: {} });
  assert.match(tools.jarPath, /2\.18\.1/);
  assert.equal(tools.javaPath, 'java');
});

test('missing tools and incorrect explicit JAR paths fail clearly without network fallback', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plantuml-missing-'));
  assert.throws(() => resolveLocalTools({ homeDir, env: {} }), /PlantUML/);
  assert.throws(() => resolveLocalTools({ homeDir, env: { PLANTUML_JAR: path.join(homeDir, 'missing.jar') } }), /PLANTUML_JAR/);
});
