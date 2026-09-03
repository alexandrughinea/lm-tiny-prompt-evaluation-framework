import fs from 'fs';
import path from 'path';

export const TEXT_EXTENSIONS = ['.txt', '.md'];

export function isTextExtension(filename) {
  return TEXT_EXTENSIONS.includes(path.extname(filename).toLowerCase());
}

export function textStem(filename) {
  if (!isTextExtension(filename)) {
    return null;
  }
  return path.basename(filename, path.extname(filename));
}

/**
 * Map stem → filename. `.txt` wins over `.md` for the same stem.
 */
export function indexTextFiles(files) {
  const byStem = new Map();
  for (const ext of TEXT_EXTENSIONS) {
    for (const file of files) {
      if (path.extname(file).toLowerCase() !== ext) {
        continue;
      }
      const stem = path.basename(file, path.extname(file));
      if (!byStem.has(stem)) {
        byStem.set(stem, file);
      }
    }
  }
  return byStem;
}

export function resolveTextPath(dir, stem) {
  for (const ext of TEXT_EXTENSIONS) {
    const candidate = path.join(dir, `${stem}${ext}`);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}
