import fs from 'fs';
import path from 'path';
import { isImageExtension } from './media-utils.js';
import { isTextExtension } from './text-files.js';

const NA_CELL = /^(n\/?a)$/i;
const JUNK_CELL = /^(none|null|-)$/i;
const SPREADSHEET_ERROR = /^#(ref|value|n\/?a|div\/0|name|null|num|error|getting_data)[!?]?$/i;
const TRUE_CELL = /^(true|yes|y|1)$/i;
const FALSE_CELL = /^(false|no|n|0)$/i;

export const STATED_CONFIDENCE = 'stated_confidence';
export const PASSTHROUGH_GOLD_KEYS = new Set(['bucket', STATED_CONFIDENCE]);
const EXTRA_STEM_EXTS = new Set(['.csv', '.json']);

export function isSpreadsheetError(raw) {
  return SPREADSHEET_ERROR.test(String(raw ?? '').trim());
}

export function isJunkHeader(name) {
  const trimmed = String(name ?? '').trim();
  return trimmed === '' || isSpreadsheetError(trimmed);
}

export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export function humanizeFieldName(name) {
  return String(name).replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

export function isGoldField(name, knownFields = []) {
  if (PASSTHROUGH_GOLD_KEYS.has(name)) {
    return true;
  }
  if (!Array.isArray(knownFields) || knownFields.length === 0) {
    return true;
  }
  return knownFields.includes(name);
}

export function foldText(raw) {
  return String(raw)
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Spreadsheet header → snake_case token.
 * `Subject Type` → subject_type; `Activity / Action` → activity_action.
 */
export function slugFieldName(name) {
  return String(name ?? '')
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Map a CSV/gold key onto a schema / report.json field when one is unique.
 * Parenthetical extras (`Visual Emphasis (focal point)`) still match `visual_emphasis`.
 */
export function canonicalFieldName(header, knownFields = []) {
  const slug = slugFieldName(header);
  if (!slug) {
    return header;
  }

  const known = (Array.isArray(knownFields) ? knownFields : [])
    .filter(name => typeof name === 'string' && name.length > 0)
    .map(name => ({ name, slug: slugFieldName(name) }));

  const exact = known.find(entry => entry.slug === slug);
  if (exact) {
    return exact.name;
  }

  const prefixed = known
    .filter(entry => entry.slug && (
      slug.startsWith(`${entry.slug}_`) || entry.slug.startsWith(`${slug}_`)
    ))
    .sort((a, b) => b.slug.length - a.slug.length);

  if (prefixed.length === 1) {
    return prefixed[0].name;
  }
  if (prefixed.length > 1 && prefixed[0].slug.length > prefixed[1].slug.length) {
    return prefixed[0].name;
  }

  return slug;
}

export function rewriteRecordKeys(record, knownFields = []) {
  if (!isPlainObject(record)) {
    return record;
  }

  const rewritten = {};
  for (const [key, value] of Object.entries(record)) {
    if (PASSTHROUGH_GOLD_KEYS.has(key)) {
      rewritten[key] = value;
      continue;
    }
    const canonical = canonicalFieldName(key, knownFields);
    if (Object.hasOwn(rewritten, canonical) && key !== canonical && slugFieldName(key) !== canonical) {
      continue;
    }
    rewritten[canonical] = value;
  }
  return rewritten;
}

export function alignGoldKeys(record, knownFields = []) {
  const rewritten = rewriteRecordKeys(record, knownFields);
  if (!isPlainObject(rewritten) || !Array.isArray(knownFields) || knownFields.length === 0) {
    return rewritten;
  }

  const aligned = {};
  for (const [key, value] of Object.entries(rewritten)) {
    if (!isGoldField(key, knownFields)) {
      continue;
    }
    aligned[key] = value;
  }
  return aligned;
}

export function caseIdFromValue(raw) {
  let text = String(raw ?? '').trim();
  if (!text) {
    return '';
  }
  if (/^https?:\/\//i.test(text)) {
    try {
      text = decodeURIComponent(new URL(text).pathname);
    } catch {
      // keep text
    }
  }
  text = text.replace(/\\/g, '/').split('/').pop() || text;
  const ext = path.extname(text);
  if (ext && (isImageExtension(text) || isTextExtension(text) || EXTRA_STEM_EXTS.has(ext.toLowerCase()))) {
    const stem = text.slice(0, -ext.length);
    return stem || text;
  }
  return text;
}

export function goldFileName(id) {
  const stem = caseIdFromValue(id);
  if (!stem) {
    throw new Error('Empty case id');
  }
  return `${stem.replace(/[/\\]/g, '_')}.json`;
}

function fieldNamesFromLabelDir(labelsDir) {
  if (!labelsDir || !fs.existsSync(labelsDir)) {
    return [];
  }
  const names = [];
  const seen = new Set();
  for (const fileName of fs.readdirSync(labelsDir)
    .filter(name => name.endsWith('.json') && !name.startsWith('_'))
    .sort()) {
    const label = readJsonIfPresent(path.join(labelsDir, fileName));
    if (!isPlainObject(label)) {
      continue;
    }
    for (const key of Object.keys(label)) {
      const name = slugFieldName(key);
      if (!name || PASSTHROUGH_GOLD_KEYS.has(name) || seen.has(name)) {
        continue;
      }
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

export function fieldNamesFromSuite({ root, schemasDir, labelsDir } = {}) {
  if (root) {
    const report = readJsonIfPresent(path.join(root, 'report.json'));
    if (Array.isArray(report?.fields) && report.fields.length > 0) {
      return report.fields.filter(name => typeof name === 'string' && name.length > 0);
    }
  }

  const schemaDir = schemasDir || (root ? path.join(root, 'schemas') : null);
  if (schemaDir) {
    const schema = readJsonIfPresent(path.join(schemaDir, 'response_format.schema.json'));
    const properties = schema?.properties;
    if (isPlainObject(properties)) {
      const fromSchema = Object.keys(properties).filter(key => key !== STATED_CONFIDENCE);
      if (fromSchema.length > 0) {
        return fromSchema;
      }
    }
  }

  return fieldNamesFromLabelDir(labelsDir);
}

export function readGoldFile(labelsDir, id, fieldNames = []) {
  if (!id) {
    return { label: null, error: 'Missing input_data_file for ground-truth scoring' };
  }

  const labelPath = path.join(labelsDir, goldFileName(id));
  try {
    const parsed = JSON.parse(fs.readFileSync(labelPath, 'utf8'));
    if (!isPlainObject(parsed)) {
      return { label: null, error: `Gold label is not a JSON object: ${labelPath}` };
    }
    return { label: alignGoldKeys(parsed, fieldNames), error: null };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { label: null, error: `Missing gold label: ${labelPath}` };
    }
    return { label: null, error: `Failed to load gold label ${labelPath}: ${error.message}` };
  }
}

export function loadNormalizeMap(filePath) {
  if (!filePath || filePath === false) {
    return {};
  }
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`normalize map must be a JSON object: ${filePath}`);
  }
  const aliases = {};
  for (const [column, mapping] of Object.entries(parsed)) {
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
      throw new Error(`normalize map "${column}" must be an object of synonym → canonical`);
    }
    aliases[column] = Object.create(null);
    for (const [from, to] of Object.entries(mapping)) {
      const key = foldText(from);
      if (to === null || to === '') {
        aliases[column][key] = null;
      } else {
        aliases[column][key] = foldText(to);
      }
    }
  }
  return aliases;
}

export function resolveAlias(value, column, aliases) {
  if (!aliases || typeof value !== 'string') {
    return value;
  }
  let current = value;
  for (let i = 0; i < 8; i += 1) {
    const fieldMap = aliases[column];
    const globalMap = aliases['*'];
    const next = fieldMap && Object.hasOwn(fieldMap, current)
      ? fieldMap[current]
      : globalMap && Object.hasOwn(globalMap, current)
        ? globalMap[current]
        : undefined;
    if (next === undefined) {
      return current;
    }
    if (next === null) {
      return null;
    }
    current = next;
  }
  return current;
}

export function enumsFromSchema(schema) {
  const properties = schema?.properties;
  if (!isPlainObject(properties)) {
    return {};
  }
  const enums = {};
  for (const [name, spec] of Object.entries(properties)) {
    if (Array.isArray(spec?.enum) && spec.enum.length > 0) {
      enums[name] = spec.enum;
    }
  }
  return enums;
}

export function fieldAllowsNa(fieldName, enums = {}) {
  const values = enums?.[fieldName];
  if (!Array.isArray(values)) {
    return false;
  }
  return values.some(value => NA_CELL.test(foldText(String(value ?? ''))));
}

export function loadSuiteEnums({ root, schemasDir } = {}) {
  const schemaDir = schemasDir || (root ? path.join(root, 'schemas') : null);
  if (!schemaDir) {
    return {};
  }
  return enumsFromSchema(readJsonIfPresent(path.join(schemaDir, 'response_format.schema.json')));
}

function allowsNa(options = {}) {
  return options.allowNa === true || fieldAllowsNa(options.column, options.enums);
}

function naValueOrSkip(options) {
  if (allowsNa(options)) {
    return { skip: false, value: 'n/a' };
  }
  return { skip: true, value: null };
}

export function coerceCell(raw, options = {}) {
  if (raw === undefined || raw === null) {
    return { skip: true, value: null };
  }
  const trimmed = String(raw).trim();
  if (trimmed === '' || JUNK_CELL.test(trimmed) || isSpreadsheetError(trimmed)) {
    return { skip: true, value: null };
  }
  if (NA_CELL.test(trimmed)) {
    return naValueOrSkip(options);
  }
  if (TRUE_CELL.test(trimmed)) {
    return { skip: false, value: true };
  }
  if (FALSE_CELL.test(trimmed)) {
    return { skip: false, value: false };
  }

  const folded = foldText(trimmed);
  const aliased = resolveAlias(folded, options.column, options.aliases);
  if (aliased === null || aliased === '') {
    return { skip: true, value: null };
  }
  if (TRUE_CELL.test(aliased)) {
    return { skip: false, value: true };
  }
  if (FALSE_CELL.test(aliased)) {
    return { skip: false, value: false };
  }
  if (NA_CELL.test(aliased)) {
    return naValueOrSkip(options);
  }
  if (JUNK_CELL.test(aliased) || isSpreadsheetError(aliased)) {
    return { skip: true, value: null };
  }
  return { skip: false, value: aliased };
}

function canonicalTokens(text) {
  const tokens = [...new Set(
    String(text)
      .split(',')
      .map(part => part.trim())
      .filter(Boolean)
  )].sort();
  if (tokens.length === 0) {
    return null;
  }
  return tokens.join(', ');
}

export function normalizeScalar(value, fieldName, aliases = {}, options = {}) {
  if (typeof value === 'boolean' || (typeof value === 'number' && !Number.isNaN(value))) {
    return value;
  }
  if (Array.isArray(value)) {
    const parts = [];
    for (const item of value) {
      const normalized = normalizeScalar(item, fieldName, aliases, options);
      if (normalized === null || normalized === undefined) {
        continue;
      }
      parts.push(String(normalized));
    }
    return canonicalTokens(parts.join(', '));
  }
  if (typeof value !== 'string') {
    return null;
  }
  const coerced = coerceCell(value, { column: fieldName, aliases, ...options });
  if (coerced.skip) {
    return null;
  }
  if (typeof coerced.value === 'string') {
    return canonicalTokens(coerced.value);
  }
  return coerced.value;
}

export function suiteAnnotationsDir(root, directories) {
  const annotations = directories?.annotations || path.join(root, 'annotations');
  const legacy = directories?.reviews || path.join(root, 'reviews');
  if (fs.existsSync(annotations)) {
    return annotations;
  }
  if (fs.existsSync(legacy)) {
    return legacy;
  }
  return annotations;
}

export function suiteNormalizePath(root, directories) {
  const dir = suiteAnnotationsDir(root, directories);
  const mapPath = path.join(dir, 'normalize.json');
  return fs.existsSync(mapPath) ? mapPath : mapPath;
}

export function loadSuiteAliases(root, directories) {
  return loadNormalizeMap(suiteNormalizePath(root, directories));
}
