// ==================== 元素引用 ====================
const inputBar = document.getElementById('inputBar');
const inputBarHeader = document.getElementById('inputBarHeader');
const inputArrow = document.getElementById('inputArrow');
const textInput = document.getElementById('textInput');
const fileInput = document.getElementById('fileInput');
const fileBtn = document.getElementById('fileBtn');
const fileName = document.getElementById('fileName');
const dropZone = document.getElementById('dropZone');
const processBtn = document.getElementById('processBtn');
const progressBar = document.getElementById('progressBar');
const statusText = document.getElementById('statusText');
const dualPanel = document.getElementById('dualPanel');
const panelRight = document.getElementById('panelRight');
const leftContent = document.getElementById('leftContent');
const rightContent = document.getElementById('rightContent');
const timeEstimate = document.getElementById('timeEstimate');
const downloadBtn = document.getElementById('downloadBtn');

let finalHtml = '';
let sectionsData = [];
let highlightObserver = null;
let startTime = 0;
let sentenceTimes = [];

function formatTime(ms) {
  if (ms <= 0) return '--';
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min > 0 ? `${min}分${sec}秒` : `${sec}秒`;
}

// ==================== 折叠输入区 ====================
inputBarHeader.addEventListener('click', () => {
  inputBar.classList.toggle('expanded');
  inputArrow.textContent = inputBar.classList.contains('expanded') ? '▲' : '▼';
  if (inputBar.classList.contains('expanded')) setTimeout(() => textInput.focus(), 150);
});

// ==================== 文件选择 / 拖拽 ====================
fileBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) fileName.textContent = fileInput.files[0].name;
});

dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  if (e.dataTransfer.files.length > 0) {
    fileInput.files = e.dataTransfer.files;
    fileName.textContent = e.dataTransfer.files[0].name;
  }
});

// ==================== 核心处理 ====================
processBtn.addEventListener('click', async () => {
  const text = textInput.value.trim();
  const file = fileInput.files[0];

  if (!text && !file) { statusText.textContent = '请先粘贴文本或选择文件'; return; }

  processBtn.disabled = true;
  processBtn.textContent = '处理中...';
  progressBar.style.width = '0%';
  statusText.textContent = '正在发送...';
  timeEstimate.textContent = '';
  downloadBtn.style.display = 'none';
  leftContent.innerHTML = '<p class="placeholder">处理中...</p>';
  rightContent.innerHTML = '<p class="placeholder">处理中...</p>';
  finalHtml = '';
  sectionsData = [];
  startTime = Date.now();
  sentenceTimes = [];
  if (highlightObserver) { highlightObserver.disconnect(); highlightObserver = null; }

  const formData = new FormData();
  if (file) formData.append('file', file);
  else formData.append('text', text);

  try {
    const response = await fetch('/api/process', { method: 'POST', body: formData });
    if (!response.ok) throw new Error('服务器错误: ' + response.status);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', resultId = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n'); buffer = lines.pop() || '';
      let eventType = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) eventType = line.slice(7).trim();
        else if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (eventType === 'complete') resultId = data.resultId;
            handleEvent(eventType, data);
          } catch (e) {}
        }
      }
    }
    // residual
    if (buffer.trim()) {
      let eventType = '';
      for (const line of buffer.split('\n')) {
        if (line.startsWith('event: ')) eventType = line.slice(7).trim();
        else if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (eventType === 'complete') resultId = data.resultId;
            handleEvent(eventType, data);
          } catch (e) {}
        }
      }
    }

    if (resultId) {
      statusText.textContent = '📥 正在获取结果...';
      const resp = await fetch('/api/result/' + resultId);
      if (resp.ok) {
        const result = await resp.json();
        finalHtml = result.html;
        sectionsData = result.sections || [];
        renderSections();
        progressBar.style.width = '100%';
        statusText.textContent = `✅ 完成！${sectionsData.length} 个段落`;
        timeEstimate.textContent = `总耗时 ${formatTime(Date.now() - startTime)}`;
        downloadBtn.style.display = 'block';
      } else {
        throw new Error('获取结果失败: ' + resp.status);
      }
    } else {
      statusText.textContent = '❌ 未收到结果 ID，请重试';
    }

  } catch (err) {
    statusText.textContent = '错误: ' + err.message;
    timeEstimate.textContent = `已用 ${formatTime(Date.now() - startTime)}`;
  }

  processBtn.disabled = false;
  processBtn.textContent = '🚀 开始处理';
});

function handleEvent(event, data) {
  if (event === 'progress') {
    if (data.step === 'ai_para') {
      statusText.textContent = data.message;
    } else if (data.step === 'split') {
      statusText.textContent = data.message;
    } else if (data.step === 'sentence') {
      const pct = Math.round((data.current / data.total) * 100);
      progressBar.style.width = pct + '%';
      const elapsed = Date.now() - startTime;
      const avg = elapsed / data.current;
      const remaining = avg * (data.total - data.current);
      timeEstimate.textContent = `已用 ${formatTime(elapsed)} | 预估剩余 ${formatTime(remaining)} | 总预估 ${formatTime(elapsed + remaining)}`;
      statusText.textContent = `[${data.current}/${data.total}] ${data.status === 'analyzing' ? '🧠 AI 分析中' : '🎨 生成思维导图'} — ${data.text}`;
    }
  } else if (event === 'error') {
    statusText.textContent = '❌ ' + data.message;
  }
}

// ==================== 双栏渲染 ====================
function renderSections() {
  if (highlightObserver) { highlightObserver.disconnect(); highlightObserver = null; }

  leftContent.innerHTML = '';
  rightContent.innerHTML = '';

  let globalIdx = 0;

  // 左栏：段落排版不变，每句包 <span data-section>，可单独点击
  for (const sec of sectionsData) {
    const paraDiv = document.createElement('div');
    paraDiv.className = 'para-text';

    for (const sent of sec.sentences) {
      const span = document.createElement('span');
      span.className = 'sent-span';
      span.setAttribute('data-section', globalIdx);
      span.title = '点击跳转到对应语法图';
      span.textContent = sent.text;
      span.addEventListener('click', ((idx) => {
        return () => {
          const target = rightContent.querySelector(`.sent-card[data-section="${idx}"]`);
          if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        };
      })(globalIdx));
      paraDiv.appendChild(span);
      // 句间空格保持间距
      paraDiv.appendChild(document.createTextNode(' '));
      globalIdx++;
    }

    leftContent.appendChild(paraDiv);
  }

  // 右栏：句子卡片（data-section = 全局句子索引）
  globalIdx = 0;
  for (const sec of sectionsData) {
    for (const sent of sec.sentences) {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = sent.html;
      const card = wrapper.firstElementChild;
      if (card) {
        card.className = card.innerHTML.includes('⚠️') ? 'sent-card error' : 'sent-card';
        card.setAttribute('data-section', globalIdx);
        rightContent.appendChild(card);
      }
      globalIdx++;
    }
  }

  statusText.textContent = `✅ 完成！${sectionsData.length} 个段落，${globalIdx} 个句子`;

  requestAnimationFrame(() => setupScrollHighlight());
}

// ==================== 滚动联动高亮 ====================
function setupScrollHighlight() {
  if (highlightObserver) highlightObserver.disconnect();

  const scrollRoot = panelRight;
  const targets = rightContent.querySelectorAll('.sent-card');

  if (!scrollRoot || targets.length === 0) return;

  const ratios = new Map();

  highlightObserver = new IntersectionObserver((entries) => {
    for (const e of entries) {
      ratios.set(e.target, e.intersectionRatio);
    }

    let best = null;
    let bestRatio = 0;
    for (const [target, ratio] of ratios) {
      if (ratio > bestRatio) {
        bestRatio = ratio;
        best = target;
      }
    }

    // 清除所有高亮
    leftContent.querySelectorAll('.sent-span.highlight').forEach(el => el.classList.remove('highlight'));

    // 高亮左栏对应的句子 span
    if (best && bestRatio > 0.05) {
      const idx = best.getAttribute('data-section');
      const leftEl = leftContent.querySelector(`.sent-span[data-section="${idx}"]`);
      if (leftEl) leftEl.classList.add('highlight');
    }
  }, {
    root: scrollRoot,
    rootMargin: '0px',
    threshold: [0, 0.1, 0.2, 0.5, 0.8]
  });

  targets.forEach(t => highlightObserver.observe(t));
}

// ==================== 下载 ====================
downloadBtn.addEventListener('click', () => {
  if (!finalHtml) return;
  const blob = new Blob([finalHtml], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '超级图文笔记.html';
  a.click();
  URL.revokeObjectURL(url);
});
