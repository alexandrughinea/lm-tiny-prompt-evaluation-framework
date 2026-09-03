import path from 'path';
import { fileURLToPath } from 'url';
import { isPlainObject, readGoldFile } from '../../../utils/label-normalize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const LABELS_DIR = path.join(__dirname, '..', 'labels');
export const BOOLEAN_FIELDS = [
  'domestic_cat',
  'person',
  'wildlife_felid',
  'contains_manmade_object'
];

export const SCHEMA_KEYS = [...BOOLEAN_FIELDS];

export { isPlainObject };

/**
 * Load gold labels for an image-only case.
 * Labels include `bucket`. Confidence is derived by the harness (self-consistency), not stored in gold.
 *
 * @param {string} inputDataFile - Test-case basename
 * @returns {{ label: object|null, error: string|null }}
 */
export function loadGoldLabel(inputDataFile) {
  return readGoldFile(LABELS_DIR, inputDataFile, BOOLEAN_FIELDS);
}
