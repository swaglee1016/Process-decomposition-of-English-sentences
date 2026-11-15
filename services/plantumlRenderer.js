/** Local Java rendering only: diagram content is never sent to an HTTP renderer. */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const childProcess = require('node:child_process');

function isFile(filename) {
  try { return fs.statSync(filename).isFile(); } catch { return false; }
}

function resolveLocalTools({ homeDir = os.homedir(), env = process.env } = {}) {
  let jarPath = env.PLANTUML_JAR;
  if (jarPath && !isFile(jarPath)) throw new Error('PLANTUML_JAR does not point to an existing file');
  if (!jarPath) {
    const candidates = [];
    for (const editor of ['.vscode', '.vscode-insiders']) {
      const directory = path.join(homeDir, editor, 'extensions');
      let names;
      try { names = fs.readdirSync(directory); } catch { continue; }
      for (const name of names) {
        const candidate = path.join(directory, name, 'plantuml.jar');
        if (name.startsWith('jebbs.plantuml-') && isFile(candidate)) candidates.push({ name, candidate });
      }
    }
    candidates.sort((a, b) => b.name.localeCompare(a.name, 'en', { numeric: true }));
    jarPath = candidates[0]?.candidate;
  }
  if (!jarPath) throw new Error('Local PlantUML JAR was not found; set PLANTUML_JAR or use the installed VS Code PlantUML extension');
  const javaHomePath = env.JAVA_HOME && path.join(env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  return { jarPath, javaPath: javaHomePath && isFile(javaHomePath) ? javaHomePath : 'java' };
}

function childEnvironment() {
  // Do not expose API credentials or JVM injection options to diagram preprocessor functions.
  const allowed = new Set(['path', 'systemroot', 'windir', 'temp', 'tmp', 'home', 'userprofile', 'lang', 'lc_all']);
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toLowerCase())));
}

function validImage(buffer, format) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return false;
  if (format === 'png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const source = buffer.toString('utf8').trim();
  return /^(?:<\?xml[^?]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg\b[^>]*xmlns=["']http:\/\/www\.w3\.org\/2000\/svg["'][\s\S]*<\/svg>\s*$/.test(source);
}

function renderLocal(pumlCode, format, localTools) {
  return new Promise(resolve => {
    const args = ['-Djava.awt.headless=true', '-DPLANTUML_SECURITY_PROFILE=SANDBOX', '-Xmx256m',
      '-jar', localTools.jarPath, '-charset', 'UTF-8', `-t${format}`, '-pipe'];
    const child = childProcess.execFile(localTools.javaPath, args, {
      encoding: 'buffer', timeout: 30000, maxBuffer: 20 * 1024 * 1024,
      windowsHide: true, shell: false, env: childEnvironment()
    }, (error, stdout) => resolve(!error && validImage(stdout, format) ? stdout : null));
    // The process may exit before consuming stdin (missing Java, invalid input, timeout).
    child.stdin.on('error', () => {});
    child.stdin.end(pumlCode, 'utf8');
  });
}

function validInput(code) {
  return typeof code === 'string' && code.trim().length > 0 && Buffer.byteLength(code, 'utf8') <= 1024 * 1024;
}

async function renderDiagram(pumlCode) {
  if (!validInput(pumlCode)) return null;
  const localTools = resolveLocalTools();
  const svg = await renderLocal(pumlCode, 'svg', localTools);
  if (svg) return { buffer: svg, mimeType: 'image/svg+xml' };
  const png = await renderLocal(pumlCode, 'png', localTools);
  return png ? { buffer: png, mimeType: 'image/png' } : null;
}

async function renderToPng(pumlCode) {
  if (!validInput(pumlCode)) return null;
  return renderLocal(pumlCode, 'png', resolveLocalTools());
}

module.exports = { renderDiagram, renderToPng, resolveLocalTools };
