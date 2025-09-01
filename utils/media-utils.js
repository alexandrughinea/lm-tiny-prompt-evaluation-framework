import fs from 'fs/promises';
import path from 'path';

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

const IMAGE_FILENAME_RE = /^(.+?)(?:\.(\d+))?\.(png|jpe?g|gif|webp)$/i;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const GIF87_MAGIC = Buffer.from('GIF87a');
const GIF89_MAGIC = Buffer.from('GIF89a');
const RIFF_MAGIC = Buffer.from('RIFF');
const WEBP_MAGIC = Buffer.from('WEBP');

function hasMagic(buffer, magic, offset = 0) {
  return buffer.length >= offset + magic.length &&
    buffer.subarray(offset, offset + magic.length).equals(magic);
}

/**
 * @param {string} filename
 * @returns {boolean}
 */
export function isImageExtension(filename) {
  return Object.hasOwn(MIME_BY_EXT, path.extname(filename).toLowerCase());
}

/**
 * Detect image MIME type from file magic bytes.
 *
 * @param {Buffer} buffer
 * @returns {string|null}
 */
export function detectImageMime(buffer) {
  if (!buffer || buffer.length < 3) {
    return null;
  }
  if (hasMagic(buffer, PNG_MAGIC)) {
    return 'image/png';
  }
  if (hasMagic(buffer, JPEG_MAGIC)) {
    return 'image/jpeg';
  }
  if (hasMagic(buffer, GIF87_MAGIC) || hasMagic(buffer, GIF89_MAGIC)) {
    return 'image/gif';
  }
  if (hasMagic(buffer, RIFF_MAGIC) && hasMagic(buffer, WEBP_MAGIC, 8)) {
    return 'image/webp';
  }
  return null;
}

/**
 * Infer a test-case basename from an image filename.
 * `photo.png` → photo; `photo.1.png` → photo.
 *
 * @param {string} filename
 * @returns {{ basename: string, index: number|null, ext: string, mime: string }|null}
 */
export function parseImageCaseFilename(filename) {
  const match = filename.match(IMAGE_FILENAME_RE);
  if (!match) {
    return null;
  }

  const ext = `.${match[3].toLowerCase()}`;
  return {
    basename: match[1],
    index: match[2] === undefined ? null : parseInt(match[2], 10),
    ext,
    mime: MIME_BY_EXT[ext],
  };
}

function matchImageForBasename(basename, filename) {
  const escaped = basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = filename.match(new RegExp(`^${escaped}(?:\\.(\\d+))?\\.(png|jpe?g|gif|webp)$`, 'i'));
  if (!match) {
    return null;
  }

  const ext = `.${match[2].toLowerCase()}`;
  return {
    index: match[1] === undefined ? null : parseInt(match[1], 10),
    ext,
    mime: MIME_BY_EXT[ext],
  };
}

/**
 * Encode an image buffer as an OpenAI-compatible data URL.
 *
 * @param {Buffer} buffer
 * @param {string} mime
 * @returns {string}
 */
export function toDataUrl(buffer, mime) {
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

/**
 * Load same-basename images, verified by magic bytes.
 *
 * @param {string} dataDir
 * @param {string} basename
 * @param {string[]} files
 * @returns {Promise<Array<{filename: string, mime: string, buffer: Buffer}>>}
 */
export async function loadSidecarImages(dataDir, basename, files) {
  const seen = new Set();
  const candidates = [];

  for (const file of files) {
    const parsed = matchImageForBasename(basename, file);
    const key = file.toLowerCase();
    if (!parsed || seen.has(key)) {
      continue;
    }
    seen.add(key);
    candidates.push({ file, ...parsed });
  }

  candidates.sort((a, b) =>
    (a.index ?? -1) - (b.index ?? -1) ||
    a.file.localeCompare(b.file, undefined, { sensitivity: 'base' })
  );

  const images = [];

  for (const candidate of candidates) {
    const buffer = await fs.readFile(path.join(dataDir, candidate.file));
    const detectedMime = detectImageMime(buffer);

    if (!detectedMime) {
      console.warn(`Skipping image ${candidate.file}: not a recognized image (magic bytes)`);
      continue;
    }

    if (detectedMime !== candidate.mime) {
      console.warn(`Skipping image ${candidate.file}: expected ${candidate.mime} but file is ${detectedMime}`);
      continue;
    }

    images.push({
      filename: candidate.file,
      mime: detectedMime,
      buffer,
    });
  }

  return images;
}

/**
 * Load image-only test cases: images with no matching .txt, grouped by basename.
 *
 * @param {string} dataDir
 * @param {string[]} files
 * @param {string[]} txtBasenames
 * @returns {Promise<Array<{name: string, text: string, images: Array<{filename: string, mime: string, buffer: Buffer}>}>>}
 */
export async function loadStandaloneImageCases(dataDir, files, txtBasenames) {
  const claimed = new Set();
  for (const basename of txtBasenames) {
    for (const file of files) {
      if (matchImageForBasename(basename, file)) {
        claimed.add(file.toLowerCase());
      }
    }
  }

  const standaloneBasenames = new Set();
  for (const file of files) {
    if (claimed.has(file.toLowerCase())) {
      continue;
    }
    const parsed = parseImageCaseFilename(file);
    if (parsed) {
      standaloneBasenames.add(parsed.basename);
    }
  }

  const cases = [];
  for (const basename of standaloneBasenames) {
    const images = await loadSidecarImages(dataDir, basename, files);
    if (images.length > 0) {
      cases.push({ name: basename, text: '', images });
    }
  }
  return cases;
}
