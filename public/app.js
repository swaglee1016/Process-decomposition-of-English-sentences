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
const downloadBtn = document.getElementById('downloadBtn');

let finalHtml = '';
let sectionsData = [];
let highlightObserver = null;

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
  downloadBtn.style.display = 'none';
  leftContent.innerHTML = '<p class="placeholder">处理中...</p>';
  rightContent.innerHTML = '<p class="placeholder">处理中...</p>';
  finalHtml = '';
  sectionsData = [];
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
        downloadBtn.style.display = 'block';
      } else {
        throw new Error('获取结果失败: ' + resp.status);
      }
    } else {
      statusText.textContent = '❌ 未收到结果 ID，请重试';
    }

  } catch (err) {
    statusText.textContent = '错误: ' + err.message;
  }

  processBtn.disabled = false;
  processBtn.textContent = '🚀 开始处理';
});

function handleEvent(event, data) {
  if (event === 'progress') {
    if (data.step === 'split') {
      statusText.textContent = data.message;
    } else if (data.step === 'sentence') {
      const pct = Math.round((data.current / data.total) * 100);
      progressBar.style.width = pct + '%';
      statusText.textContent = `[${data.current}/${data.total}] ${data.status === 'analyzing' ? '🧠 AI 分析中' : '🎨 生成思维导图'} — ${data.text}`;
    }
  } else if (event === 'error') {
    statusText.textContent = '❌ ' + data.message;
  }
}

// ==================== 双栏渲染（仅独立模式） ====================
function renderSections() {
  // 注销旧 observer
  if (highlightObserver) { highlightObserver.disconnect(); highlightObserver = null; }

  leftContent.innerHTML = '';
  rightContent.innerHTML = '';

  // 左栏：段落文字（带 data-section + 点击跳转）
  for (const [i, sec] of sectionsData.entries()) {
    const paraDiv = document.createElement('div');
    paraDiv.className = 'para-text';
    paraDiv.setAttribute('data-section', i);
    paraDiv.title = '点击跳转到对应语法图';
    paraDiv.textContent = sec.paragraph;
    paraDiv.addEventListener('click', () => {
      const rightBlock = rightContent.querySelector(`.section-block[data-section="${i}"]`);
      if (rightBlock) {
        rightBlock.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    leftContent.appendChild(paraDiv);
  }

  // 右栏：段落标题 + 句子卡片（带 data-section）
  for (const [i, sec] of sectionsData.entries()) {
    const block = document.createElement('div');
    block.className = 'section-block';
    block.setAttribute('data-section', i);

    const header = document.createElement('div');
    header.className = 'para-header';
    header.textContent = sec.paragraph;
    block.appendChild(header);

    for (const sent of sec.sentences) {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = sent.html;
      const card = wrapper.firstElementChild;
      if (card) {
        card.className = card.innerHTML.includes('⚠️') ? 'sent-card error' : 'sent-card';
      }
      block.appendChild(wrapper.firstElementChild);
    }
    rightContent.appendChild(block);
  }

  // DOM 就绪后挂 observer
  requestAnimationFrame(() => setupScrollHighlight());
}

// ==================== 滚动联动高亮 ====================
function setupScrollHighlight() {
  if (highlightObserver) highlightObserver.disconnect();

  // 右栏滚动容器 = .panel-right（overflow-y: auto 的那个）
  const scrollRoot = panelRight;
  // 监视目标 = 右栏每个 section-block
  const targets = rightContent.querySelectorAll('.section-block');

  if (!scrollRoot || targets.length === 0) return;

  // 记录每个 target 当前的可见比例
  const ratios = new Map();

  highlightObserver = new IntersectionObserver((entries) => {
    for (const e of entries) {
      ratios.set(e.target, e.intersectionRatio);
    }

    // 找可见比例最大的那个
    let best = null;
    let bestRatio = 0;
    for (const [target, ratio] of ratios) {
      if (ratio > bestRatio) {
        bestRatio = ratio;
        best = target;
      }
    }

    // 清除所有左栏高亮
    leftContent.querySelectorAll('.highlight').forEach(el => el.classList.remove('highlight'));

    // 高亮对应的左栏段落
    if (best && bestRatio > 0.05) {
      const idx = best.getAttribute('data-section');
      const leftEl = leftContent.querySelector(`[data-section="${idx}"]`);
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
