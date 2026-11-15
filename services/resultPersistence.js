const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const htmlBuilder = require('./htmlBuilder');

function twoDigits(value) {
  return String(value).padStart(2, '0');
}

function formatTimestamp(date) {
  return [
    date.getFullYear(),
    twoDigits(date.getMonth() + 1),
    twoDigits(date.getDate())
  ].join('') + '-' + [
    twoDigits(date.getHours()),
    twoDigits(date.getMinutes()),
    twoDigits(date.getSeconds())
  ].join('');
}

async function availableFilename(outputDir, timestamp) {
  const base = `sentence-decomposition-${timestamp}`;
  let suffix = 0;
  const existing = await fs.readdir(outputDir);

  while (true) {
    const filename = `${base}${suffix === 0 ? '' : `-${suffix}`}.html`;
    const stem = filename.slice(0, -5);
    if (existing.some(name => name === filename || name.startsWith(stem + '-diagram-'))) {
      suffix += 1;
      continue;
    }
    try {
      // Retain this zero-byte reservation: it protects the whole set of pages
      // across processes and retries without deleting user artifacts.
      const reservation = await fs.open(path.join(outputDir, `.${filename}.reserve`), 'wx');
      await reservation.close();
      return filename;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      suffix += 1;
    }
  }
}

async function saveResult({ sections, original = null, vocabulary = null, outputDir, now = new Date() }) {
  if (!Array.isArray(sections)) {
    throw new TypeError('sections must be an array');
  }

  await fs.mkdir(outputDir, { recursive: true });
  const resultId = crypto.randomUUID();
  const filename = await availableFilename(outputDir, formatTimestamp(now));
  const outputPath = path.join(outputDir, filename);
  const temporaryPath = path.join(outputDir, `.${filename}.${resultId}.tmp`);
  const savedSections = [];
  let sentenceNumber = 0;
  for (const section of sections) {
    const savedSection = { ...section, sentences: [] };
    for (const sentence of section.sentences || []) {
      sentenceNumber++;
      const { diagram, ...savedSentence } = sentence;
      if (diagram) {
        const diagramFilename = filename.replace(/\.html$/, `-diagram-${sentenceNumber}.html`);
        const diagramHtml = htmlBuilder.buildDiagramPage(sentence.text, diagram.base64, diagram.mimeType);
        await fs.writeFile(path.join(outputDir, diagramFilename), diagramHtml, {encoding:'utf8', flag:'wx'});
        savedSentence.diagramFilename = diagramFilename;
        savedSentence.diagramUrl = `/outputs/${encodeURIComponent(diagramFilename)}`;
        savedSentence.html = htmlBuilder.buildSentenceHtml(sentence.text, diagram.base64, diagram.mimeType, diagramFilename);
      }
      savedSection.sentences.push(savedSentence);
    }
    savedSections.push(savedSection);
  }
  const html = htmlBuilder.buildCompleteStudyHtml(savedSections, { generatedAt: now, original, vocabulary, filename });

  await fs.writeFile(temporaryPath, html, 'utf8');
  await fs.rename(temporaryPath, outputPath);

  return { resultId, filename, outputPath, html, sections: savedSections, original, vocabulary };
}

module.exports = { saveResult };
