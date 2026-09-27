# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

将英文文章粘贴或上传到网页 → 智能分段/分句 → DeepSeek 语法分析 → PlantUML 思维导图 → 双栏排版输出（左=排版好的文章，右=段落标题+语法图）。支持左右双向联动：点击左栏段落右侧跳转，滚动右栏左侧高亮。

原始逻辑从 n8n 工作流迁移而来。

## 启动

```bash
# 配置 .env（DeepSeek API Key、PlantUML URL）
# DEEPSEEK_API_KEY=sk-xxx
# DEEPSEEK_MODEL=deepseek-chat
# PLANTUML_URL=http://localhost:8000/plantuml/png  （可选）
# PORT=3456

npm install
npm start       # node server.js
npm run dev     # node --watch server.js（开发模式，自动重启）
```

需要 PlantUML 渲染图片。优先调本地 Docker（`localhost:8000`），fallback 到 kroki.io 免费在线服务。

## 架构

```
浏览器 (public/) ←→ Express server.js ←→ services/
                         │
                    SSE 推送进度，完成后返回 resultId
                    先将完整双栏 HTML 写入 outputs/
                    客户端 GET /api/result/:id 获取 { html, sections, filename, outputUrl }
```

- **server.js** — Express 入口。POST `/api/process`（SSE 流式进度推送），GET `/api/result/:id`（JSON 含 html、sections、filename、outputUrl）。内存 Map 只服务当前会话且 10 分钟过期，`outputs/` 中的完整 HTML 永久保留。
- **public/** — 纯前端：折叠输入区 + 双栏输出（Grid 布局，左右独立滚动）+ 底部工具栏。
- **services/textSplitter.js** — 段落拆分 + Intl.Segmenter 智能分句。输出 `{ type, text/my_sentence }` 交替数组，顺序即段落→句子→段落→句子。
- **services/deepseek.js** — 调 DeepSeek API，返回 PlantUML 思维导图描述。
- **services/plantumlCode.js** — 修正 AI 输出的 PlantUML 代码（自动换行、纠错、确保单根节点）。
- **services/plantumlRenderer.js** — 调 PlantUML 服务渲染 PNG，本地 Docker 优先，kroki.io fallback，均带 AbortController 超时。
- **services/htmlBuilder.js** — 拼装自包含的完整离线双栏 HTML 文件。
- **services/resultPersistence.js** — 创建 `outputs/`、生成时间戳文件名并原子写入完整 HTML。
- **public/app.js** — SSE 消费 → sections 渲染双栏 DOM → IntersectionObserver 滚动高亮 → 点击跳转联动 → 打开已保存文件。

## 数据流关键点

`splitText()` 返回的数组顺序直接决定输出排版：段落标题先写，然后是该段落下的所有句子+图，再下一段。server.js 的 items 循环按此顺序构建 sections 数组。

SSE 不传大数据，complete 事件只发 `{ resultId }`。在发送 complete 前，服务端必须先用 `saveResult()` 将完整双栏页面写入 `outputs/`。客户端单独 GET `/api/result/:id` 获取结构化数据和已保存文件地址；不能退回 Blob URL 或仅内存保存。

## .env 不进 git

`.gitignore` 已排除 .env。API key 不进代码、不进 commit。
