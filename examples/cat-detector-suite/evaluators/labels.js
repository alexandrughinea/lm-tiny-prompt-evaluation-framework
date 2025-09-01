import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const LABELS_DIR = path.join(__dirname, '..', 'labels');
export const BOOLEAN_FIELDS = [
  'domestic_cat',
  'person',
  'wildlife_felid',
  'contains_manmade_object'
];

export const SCHEMA_KEYS = [...BOOLEAN_FIELDS, 'stated_confidence'];

export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Load gold labels for an image-only case.
 * Labels omit `stated_confidence`. They include `bucket`.
 *
 * @param {string} inputDataFile - Test-case basename
 * @returns {{ label: object|null, error: string|null }}
 */
export function loadGoldLabel(inputDataFile) {
  if (!inputDataFile) {
    return { label: null, error: 'Missing input_data_file for ground-truth scoring' };
  }

  const labelPath = path.join(LABELS_DIR, `${inputDataFile}.json`);

  try {
    const parsed = JSON.parse(fs.readFileSync(labelPath, 'utf8'));
    if (!isPlainObject(parsed)) {
      return { label: null, error: `Gold label is not a JSON object: ${labelPath}` };
    }
    return { label: parsed, error: null };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { label: null, error: `Missing gold label: ${labelPath}` };
    }
    return { label: null, error: `Failed to load gold label ${labelPath}: ${error.message}` };
  }
}
