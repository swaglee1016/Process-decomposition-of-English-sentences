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

  while (true) {
    const filename = `${base}${suffix === 0 ? '' : `-${suffix}`}.html`;
    try {
      await fs.access(path.join(outputDir, filename));
      suffix += 1;
    } catch (error) {
      if (error.code === 'ENOENT') return filename;
      throw error;
    }
  }
}

async function saveResult({ sections, outputDir, now = new Date() }) {
  if (!Array.isArray(sections)) {
    throw new TypeError('sections must be an array');
  }

  await fs.mkdir(outputDir, { recursive: true });
  const resultId = crypto.randomUUID();
  const filename = await availableFilename(outputDir, formatTimestamp(now));
  const outputPath = path.join(outputDir, filename);
  const temporaryPath = path.join(outputDir, `.${filename}.${resultId}.tmp`);
  const html = htmlBuilder.buildCompleteStudyHtml(sections, { generatedAt: now });

  await fs.writeFile(temporaryPath, html, 'utf8');
  await fs.rename(temporaryPath, outputPath);

  return { resultId, filename, outputPath, html };
}

module.exports = { saveResult };
