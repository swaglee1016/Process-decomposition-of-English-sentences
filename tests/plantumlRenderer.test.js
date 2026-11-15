const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const { PassThrough } = require('node:stream');
const renderer = require('../services/plantumlRenderer');
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"></svg>');
const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
function mockJava(t, responder) {
  const calls = [];
  t.mock.method(global, 'fetch', () => { throw new Error('No network is permitted for diagram rendering'); });
  t.mock.method(childProcess, 'execFile', (file, args, options, callback) => {
    const stdin = new PassThrough();
    let input = '';
    stdin.on('data', chunk => { input += chunk; });
    stdin.on('end', () => {
      const call = {file, args, options, input}; calls.push(call);
      const result = responder(call);
      setImmediate(() => callback(result.error || null, result.buffer || Buffer.alloc(0), Buffer.alloc(0)));
    });
    return {stdin};
  });
  return calls;
}
test('local Java produces SVG using stdin, sandbox, bounded resources and no shell/network', async t => {
  assert.equal(typeof renderer.renderDiagram, 'function');
  const calls = mockJava(t, () => ({buffer:svg}));
  const code = '@startmindmap\n* Mr. Smith\n@endmindmap';
  const result = await renderer.renderDiagram(code);
  assert.equal(result.mimeType, 'image/svg+xml'); assert.deepEqual(result.buffer, svg);
  assert.equal(calls.length, 1); assert.equal(calls[0].input, code);
  assert.ok(calls[0].args.includes('-DPLANTUML_SECURITY_PROFILE=SANDBOX'));
  assert.ok(calls[0].args.includes('-tsvg')); assert.ok(calls[0].args.includes('-pipe'));
  assert.equal(calls[0].options.shell, false); assert.equal(calls[0].options.windowsHide, true);
  assert.ok(calls[0].options.timeout > 0 && calls[0].options.maxBuffer > 0);
  assert.equal('DEEPSEEK_API_KEY' in calls[0].options.env, false);
  assert.equal('JAVA_TOOL_OPTIONS' in calls[0].options.env, false);
  assert.equal(calls[0].args.includes(code), false);
});
test('SVG failure falls back to PNG locally', async t => {
  assert.equal(typeof renderer.renderDiagram, 'function');
  const calls = mockJava(t, call => call.args.includes('-tsvg') ? {error:new Error('unsupported')} : {buffer:png});
  assert.equal((await renderer.renderDiagram('diagram')).mimeType, 'image/png');
  assert.equal(calls.length, 2);
});
test('invalid image output and failed Java process do not become successful diagrams', async t => {
  assert.equal(typeof renderer.renderDiagram, 'function');
  const calls = mockJava(t, () => ({buffer:Buffer.from('<html>error</html>')}));
  assert.equal(await renderer.renderDiagram('diagram'), null); assert.equal(calls.length, 2);
});
test('legacy PNG interface still uses the local Java renderer', async t => {
  mockJava(t, () => ({buffer:png}));
  assert.deepEqual(await renderer.renderToPng('diagram'), png);
});
