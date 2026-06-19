# English Sentences Process Decomposition

粘贴英文文章 → AI 智能分段 → 逐句语法分析 → PlantUML 思维导图 → 双栏对照输出。

> 原流程为 n8n 工作流，现迁移为独立 Web 应用。双击 `start.bat` 即用。

---

## 功能

- **智能分段** — AI 自动识别 PDF/复制文本中的假换行，按语义重排段落
- **逐句语法拆解** — DeepSeek 对每句话分析句型、主谓宾、从句、固定搭配，生成 PlantUML 思维导图
- **双栏对照** — 左栏排版好的原文（句级可点击），右栏语法思维导图（含中文翻译 + 核心语法点标注）
- **双向联动** — 点击左栏句子 → 右栏自动滚动到对应语法图; 滚动右栏 → 左栏对应句子高亮
- **实时时间预估** — 进度条显示已用时间、预估剩余时间、预估总时间
- **文件上传 + 粘贴** — 支持直接粘贴文本，或拖拽上传 `.txt` / `.pdf`
- **下载 HTML** — 处理完成后可下载完整图文笔记（可离线查看）

## 快速开始

### 1. 配置 API Key

在项目目录创建 `.env` 文件（已列入 `.gitignore`，不会上传）：

```env
DEEPSEEK_API_KEY=sk-你的DeepSeek密钥
DEEPSEEK_MODEL=deepseek-chat
PORT=3456
```

DeepSeek API Key 在 [platform.deepseek.com](https://platform.deepseek.com) 获取（新用户有免费额度）。

### 2. 安装依赖（仅首次）

```bash
npm install
```

### 3. 启动

**方式一：双击 `start.bat`**（推荐）

自动打开浏览器并启动服务。

**方式二：命令行**

```bash
npm start        # 启动服务
npm run dev      # 开发模式（文件改动自动重启）
```

浏览器打开 `http://localhost:3456`，点击顶部「📝 点击输入文章」，粘贴英文文章，点「🚀 开始处理」。

### 4. （可选）本地 PlantUML 加速

项目默认用 kroki.io 在线渲染思维导图。需要更快速度或离线使用时，可启动本地 Docker：

```bash
docker run -d -p 8000:8080 --name plantuml-server plantuml/plantuml-server:jetty
```

代码会自动检测本地 Docker，不可用时 fallback 到在线服务。

## 界面说明

```
┌── 输入区（折叠）─────────────────────┐
│  📝 点击输入文章          [展开 ▼]    │
├─────────────────────────────────────┤
│  进度条 ████████░░░░  已用3s｜剩28s  │
├────────────────┬────────────────────┤
│ 📄 排版好的文章  │ 📊 语法思维导图     │
│                │                    │
│ He walked down │ ┌────────────────┐ │
│ to the corner. │ │ 简单句          │ │
│ ← 点击跳转     │ │ ├ 完整英文句子   │ │
│                │ │ ├ 中文翻译      │ │
│ A few cars     │ │ ├ 主语 we      │ │
│ passed.        │ │ ├ 谓语 walked  │ │
│                │ │ └ [思维导图PNG] │ │
│                │ └────────────────┘ │
├────────────────┴────────────────────┤
│  左右独立滚动         ⬇️ 下载 HTML   │
└─────────────────────────────────────┘
```

- **点击左栏任意句子** → 右栏自动平滑滚动到对应的语法思维导图
- **滚动右栏** → 左栏当前可见的句子自动高亮（淡蓝背景）
- 两栏各自独立滚动，互不影响

## 项目结构

```
services/              ← 后端服务模块
├── deepseek.js        ← DeepSeek API 调用（含重试、超时）
├── paragraphSplitter.js ← AI 语义段落重排
├── textSplitter.js    ← 段落/句子拆分（Intl.Segmenter）
├── plantumlCode.js    ← PlantUML 代码修正（换行、纠错）
├── plantumlRenderer.js ← PlantUML → PNG（Docker/kroki 双路）
└── htmlBuilder.js     ← 下载版 HTML 拼装

public/                ← 前端（纯 HTML/CSS/JS，零框架）
├── index.html         ← 页面结构
├── style.css          ← 样式
└── app.js             ← SSE 流消费、双栏渲染、联动高亮

server.js              ← Express 服务入口
start.bat              ← 一键启动脚本（Windows）
```

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Node.js + Express |
| 实时推送 | SSE (Server-Sent Events) |
| AI | DeepSeek API（deepseek-chat） |
| 思维导图 | PlantUML（本地 Docker 或 kroki.io） |
| 前端 | 原生 HTML/CSS/JS，零 npm 前端依赖 |
| 文本分句 | `Intl.Segmenter`（浏览器原生 API） |
| 滚动联动 | `IntersectionObserver` |

## 工作原理

```
输入文本（可能有 PDF 假换行）
    │
    ▼
paragraphSplitter: AI 语义分段（修复假换行）
    │
    ▼
textSplitter: 真段落切分 + Intl.Segmenter 智能分句
    │
    ▼
  ┌─ 段落1标题 ─────────────────────┐
  │  句子1 → DeepSeek → PlantUML码  │
  │        → PNG渲染 → 卡片HTML     │
  │  句子2 → DeepSeek → ...         │
  ├─ 段落2标题 ─────────────────────┤
  │  句子3 → ...                     │
  └─────────────────────────────────┘
    │
    ▼
双栏渲染: sections[] 驱动 DOM 构建
完整HTML: 用于下载
```

## 版本

- **v1.2** — 时间预估追踪 + start.bat 一键启动
- **v1.1** — AI 段落拆分 + 重试容错
- **v1.0** — 初始版本（n8n 迁移）
