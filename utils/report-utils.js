import fs from 'fs';
import path from 'path';
import { CONFIGURATION } from '../src/config.js';

const SCALAR_SCHEMA_TYPES = new Set(['boolean', 'string', 'number', 'integer']);

function asResultList(source) {
  if (!source) {
    return [];
  }
  return Array.isArray(source) ? source : [source];
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isReportableScalar(value) {
  return typeof value === 'boolean' || typeof value === 'string' || (typeof value === 'number' && !Number.isNaN(value));
}

export function scoreField(predicted, gold) {
  const normalizedPredicted = isReportableScalar(predicted) ? predicted : null;
  const normalizedGold = isReportableScalar(gold) ? gold : null;
  return {
    predicted: normalizedPredicted,
    gold: normalizedGold,
    correct: normalizedPredicted !== null && normalizedGold !== null && Object.is(normalizedPredicted, normalizedGold)
  };
}

export function fieldPredicted(fields, name) {
  const entry = fields?.[name];
  if (!isPlainObject(entry)) {
    return null;
  }
  return isReportableScalar(entry.predicted) ? entry.predicted : null;
}

export function fieldGold(fields, name) {
  const entry = fields?.[name];
  if (!isPlainObject(entry)) {
    return null;
  }
  return isReportableScalar(entry.gold) ? entry.gold : null;
}

export function formatYesNo(value) {
  if (value === true) {
    return 'Yes';
  }
  if (value === false) {
    return 'No';
  }
  return 'N/A';
}

export function formatScalar(value) {
  if (typeof value === 'boolean') {
    return formatYesNo(value);
  }
  if (typeof value === 'number' && !Number.isNaN(value)) {
    return String(value);
  }
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return 'N/A';
}

export function formatPredicted(fields, name) {
  return formatScalar(fieldPredicted(fields, name));
}

export function formatGold(fields, name) {
  return formatScalar(fieldGold(fields, name));
}

export function formatMatch(fields, name) {
  const score = fieldMatchScore(fields, name);
  if (score === null) {
    return 'N/A';
  }
  return formatYesNo(score === 1);
}

export function humanizeFieldName(name) {
  return String(name).replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

export function fieldMatchScore(fields, name) {
  const entry = fields?.[name];
  if (typeof entry === 'number' && !Number.isNaN(entry)) {
    return entry;
  }
  if (typeof entry === 'boolean') {
    return entry ? 1 : 0;
  }
  if (isPlainObject(entry)) {
    if (typeof entry.correct === 'boolean') {
      return entry.correct ? 1 : 0;
    }
    if (typeof entry.correct === 'number' && !Number.isNaN(entry.correct)) {
      return entry.correct;
    }
  }
  return null;
}

export function fieldMissCount(fields) {
  if (!isPlainObject(fields)) {
    return 0;
  }
  return Object.keys(fields).filter(name => fieldMatchScore(fields, name) === 0).length;
}

export function meanFieldMatch(fields) {
  if (!isPlainObject(fields)) {
    return null;
  }
  const values = Object.keys(fields)
    .map(name => fieldMatchScore(fields, name))
    .filter(score => typeof score === 'number' && !Number.isNaN(score));
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function exactFieldMatch(fields) {
  const mean = meanFieldMatch(fields);
  if (mean === null) {
    return null;
  }
  return mean === 1 ? 1 : 0;
}

export function parseConfidence(value) {
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0 || value > 1) {
    return null;
  }
  return value;
}

export function brierScore(statedConfidence, y) {
  if (parseConfidence(statedConfidence) === null) {
    return null;
  }
  if (y !== 0 && y !== 1) {
    return null;
  }
  const residual = statedConfidence - y;
  return residual * residual;
}

const ZERO_DIVISION = 0;

export function fieldConfusion(fields, name) {
  const gold = fieldGold(fields, name);
  const predicted = fieldPredicted(fields, name);
  if (typeof gold !== 'boolean' || typeof predicted !== 'boolean') {
    return null;
  }
  return {
    tp: gold && predicted ? 1 : 0,
    fp: !gold && predicted ? 1 : 0,
    fn: gold && !predicted ? 1 : 0,
    tn: !gold && !predicted ? 1 : 0
  };
}

function f1FromConfusion(confusion) {
  if (!confusion) {
    return null;
  }
  const { tp, fp, fn } = confusion;
  const precision = tp + fp === 0 ? ZERO_DIVISION : tp / (tp + fp);
  const recall = tp + fn === 0 ? ZERO_DIVISION : tp / (tp + fn);
  if (precision + recall === 0) {
    return ZERO_DIVISION;
  }
  return (2 * precision * recall) / (precision + recall);
}

function precisionFromConfusion(confusion) {
  if (!confusion) {
    return null;
  }
  const { tp, fp } = confusion;
  return tp + fp === 0 ? ZERO_DIVISION : tp / (tp + fp);
}

function recallFromConfusion(confusion) {
  if (!confusion) {
    return null;
  }
  const { tp, fn } = confusion;
  return tp + fn === 0 ? ZERO_DIVISION : tp / (tp + fn);
}

function accuracyFromConfusion(confusion) {
  if (!confusion) {
    return null;
  }
  const total = confusion.tp + confusion.fp + confusion.fn + confusion.tn;
  if (total === 0) {
    return null;
  }
  return (confusion.tp + confusion.tn) / total;
}

function emptyConfusion() {
  return { tp: 0, fp: 0, fn: 0, tn: 0 };
}

function addConfusion(target, extra) {
  target.tp += extra.tp;
  target.fp += extra.fp;
  target.fn += extra.fn;
  target.tn += extra.tn;
}

export function poolFieldConfusion(results, fieldNames = []) {
  const names = fieldNames.length > 0 ? fieldNames : inferFieldNamesFromResults(results);
  const pooled = Object.create(null);
  for (const name of names) {
    pooled[name] = emptyConfusion();
  }
  for (const result of asResultList(results)) {
    for (const name of names) {
      const confusion = fieldConfusion(result.quantitative?.fields, name);
      if (confusion) {
        addConfusion(pooled[name], confusion);
      }
    }
  }
  return { names, pooled };
}

export function macroF1FromResults(results, fieldNames = []) {
  const { names, pooled } = poolFieldConfusion(results, fieldNames);
  if (names.length === 0) {
    return null;
  }
  const scores = names.map(name => f1FromConfusion(pooled[name]));
  return scores.reduce((sum, value) => sum + value, 0) / scores.length;
}

export function perFieldClassification(results, fieldNames = []) {
  const { names, pooled } = poolFieldConfusion(results, fieldNames);
  return names.map(name => ({
    name,
    precision: precisionFromConfusion(pooled[name]),
    recall: recallFromConfusion(pooled[name]),
    f1: f1FromConfusion(pooled[name]),
    accuracy: accuracyFromConfusion(pooled[name])
  }));
}

export function inferFieldNamesFromResults(source) {
  const names = [];
  const seen = new Set();

  for (const result of asResultList(source)) {
    const fields = result?.quantitative?.fields;
    if (!isPlainObject(fields)) {
      continue;
    }
    for (const name of Object.keys(fields)) {
      if (!seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
  }

  return names;
}

function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function scalarSchemaFields(schema) {
  const properties = schema?.properties;
  if (!isPlainObject(properties)) {
    return [];
  }
  return Object.keys(properties).filter(key => {
    const type = properties[key]?.type;
    return SCALAR_SCHEMA_TYPES.has(type) && key !== 'stated_confidence';
  });
}

export function loadFieldNamesFromSuite() {
  const root = CONFIGURATION.directories.root;
  const parsed = readJsonIfPresent(path.join(root, 'report.json'));
  if (Array.isArray(parsed?.fields) && parsed.fields.length > 0) {
    return parsed.fields.filter(name => typeof name === 'string' && name.length > 0);
  }

  return scalarSchemaFields(
    readJsonIfPresent(path.join(CONFIGURATION.directories.schemas, 'response_format.schema.json'))
  );
}

export function resolveFieldNames(source) {
  const configured = loadFieldNamesFromSuite();
  const inferred = inferFieldNamesFromResults(source);
  if (configured.length === 0) {
    return inferred;
  }
  const extra = inferred.filter(name => !configured.includes(name));
  return configured.concat(extra);
}

export function markdownTable(headers, rows) {
  const line = (cells) => `| ${cells.join(' | ')} |\n`;
  const separator = `| ${headers.map(() => '-------').join(' | ')} |\n`;
  return line(headers) + separator + rows.map(row => line(row)).join('');
}

export function detectReportMeta(source) {
  const results = asResultList(source);
  const kinds = new Set(results.map(result => result?.input?.kind || result?.input_kind).filter(Boolean));
  return {
    bucket: results.some(result => result?.quantitative?.bucket),
    format_valid: results.some(result => result?.quantitative?.format_valid !== undefined),
    kind: kinds.size > 1,
    fields: resolveFieldNames(results)
  };
}
