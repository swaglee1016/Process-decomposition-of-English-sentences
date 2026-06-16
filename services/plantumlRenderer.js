/**
 * PlantUML 渲染 — 迁移自 n8n "Generate Image1" 节点
 * 先尝试本地 Docker，失败则 fallback 到 kroki.io 在线服务
 */

const PLANTUML_LOCAL = process.env.PLANTUML_URL || 'http://localhost:8000/plantuml/png';
const KROKI_URL = 'https://kroki.io/plantuml/png';

async function tryRender(url, pumlCode, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: pumlCode,
      signal: controller.signal
    });
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } finally {
    clearTimeout(timeout);
  }
}

async function renderToPng(pumlCode) {
  // 先尝试本地 Docker（短超时，因为本地应该很快或直接失败）
  try {
    const result = await tryRender(PLANTUML_LOCAL, pumlCode, 8000);
    if (result) return result;
  } catch {
    // 本地不可用，fallback
  }

  // 尝试 kroki.io（长超时，外网可能慢）
  try {
    const result = await tryRender(KROKI_URL, pumlCode, 30000);
    if (result) return result;
  } catch {
    // kroki 也失败
  }

  return null;
}

module.exports = { renderToPng };
