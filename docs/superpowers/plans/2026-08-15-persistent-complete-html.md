# Persistent Complete HTML Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save every completed analysis as a self-contained, full two-column HTML file in `outputs/` so it remains viewable after the browser and Node.js server are closed.

**Architecture:** Add a filesystem persistence module that receives the existing `sections` model, asks `htmlBuilder` for a complete offline document, and atomically writes a timestamped file. Keep the in-memory result API for the active UI, but return the saved filename and URL so the UI downloads the persisted file instead of creating a temporary `blob:` URL.

**Tech Stack:** Node.js, Express, Node built-in test runner, HTML/CSS/vanilla JavaScript.

## Global Constraints

- The saved page contains the left article and the complete right sentence/diagram content.
- The page must work from `file://` with the server stopped.
- Generated images remain embedded as `data:` URLs.
- Do not modify `.env`, credentials, deployment, or CI configuration.
- Do not automatically delete saved outputs.

---

### Task 1: Restore the tracked web entry and define output boundaries

**Files:**
- Modify: `.gitignore`
- Create: `public/index.html`
- Modify: `package.json`

**Interfaces:**
- `public/index.html` provides every DOM id consumed by `public/app.js`.
- `npm test` runs `node --test`.

- [ ] Replace the broad `*.html` ignore rule with `/outputs/*.html`.
- [ ] Recreate the missing two-column application entry page.
- [ ] Add the built-in Node test command.
- [ ] Verify the entry page references `style.css` and `app.js` and contains all required ids.

### Task 2: Specify persistent complete-page behavior with failing tests

**Files:**
- Create: `tests/resultPersistence.test.js`
- Create: `tests/htmlBuilder.test.js`

**Interfaces:**
- `html.buildCompleteStudyHtml(sections, { generatedAt }) -> string`
- `saveResult({ sections, outputDir, now }) -> Promise<{ resultId, filename, outputPath, html }>`

- [ ] Test that the complete document contains both column labels, all article sentences, all right-column card HTML, embedded interaction script, and no server URL dependency.
- [ ] Test that `saveResult` creates `outputs/` when absent and writes a timestamped UTF-8 HTML file.
- [ ] Run `node --test` and confirm failure because the interfaces do not exist.

### Task 3: Implement complete-page generation and disk persistence

**Files:**
- Modify: `services/htmlBuilder.js`
- Create: `services/resultPersistence.js`

**Interfaces:**
- `buildCompleteStudyHtml` escapes all left-column text and preserves right-column generated card markup.
- `saveResult` creates a collision-safe filename and writes through a temporary file followed by rename.

- [ ] Implement the minimum HTML builder required by the tests.
- [ ] Implement output directory creation, timestamp naming, and atomic write.
- [ ] Run `node --test` and confirm all persistence tests pass.

### Task 4: Integrate persisted results with the server and browser UI

**Files:**
- Modify: `server.js`
- Modify: `public/app.js`
- Modify: `public/style.css`
- Modify: `README.md`

**Interfaces:**
- `GET /api/result/:id` returns `{ html, sections, filename, outputUrl }`.
- `/outputs/<filename>` serves the saved artifact while the server is running.
- The download button uses `outputUrl`; the UI displays the relative saved path.

- [ ] Save the full result before emitting the SSE `complete` event.
- [ ] Keep in-memory retrieval for the active page, but remove client-side Blob download creation.
- [ ] Show `outputs/<filename>` after completion and point download to the persistent file.
- [ ] Document that users can reopen the saved HTML directly after the server closes.

### Task 5: Verify runtime and offline viewing

**Files:**
- Test: `tests/*.test.js`
- Verify: generated temporary HTML fixture

- [ ] Run the complete Node test suite.
- [ ] Start the Express server and verify `/`, `style.css`, and `app.js` return successfully.
- [ ] Generate a fixture through `saveResult`, open it directly from disk, and verify both columns and interaction markup exist without the server.
- [ ] Review `git diff` and confirm no `.env`, secret, deployment, or unrelated changes.
