import { CONFIGURATION } from '../src/config.js';
import {
  fieldNamesFromSuite,
  isPlainObject,
  loadSuiteAliases,
  normalizeScalar
} from './label-normalize.js';

export { humanizeFieldName } from './label-normalize.js';

function asResultList(source) {
  if (!source) {
    return [];
  }
  return Array.isArray(source) ? source : [source];
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
    correct: normalizedGold === null
      ? null
      : normalizedPredicted !== null && Object.is(normalizedPredicted, normalizedGold)
  };
}

export function scoreFieldNormalized(predicted, gold, fieldName, aliases = {}, options = {}) {
  const normalizedPredicted = normalizeScalar(predicted, fieldName, aliases, options);
  const normalizedGold = normalizeScalar(gold, fieldName, aliases, options);
  return {
    predicted: normalizedPredicted,
    gold: normalizedGold,
    correct: normalizedGold === null
      ? null
      : normalizedPredicted !== null && Object.is(normalizedPredicted, normalizedGold)
  };
}

export function loadScoringAliases() {
  const root = CONFIGURATION.directories.root;
  return loadSuiteAliases(root, CONFIGURATION.directories);
}

export function inferBooleanFieldNames(results, fieldNames = []) {
  const names = fieldNames.length > 0 ? fieldNames : inferFieldNamesFromResults(results);
  return names.filter(name =>
    asResultList(results).some(result => typeof fieldGold(result.quantitative?.fields, name) === 'boolean')
  );
}

export function perFieldAccuracy(results, fieldNames = []) {
  const names = fieldNames.length > 0 ? fieldNames : inferFieldNamesFromResults(results);
  return names.map(name => {
    const scores = asResultList(results)
      .map(result => fieldMatchScore(result.quantitative?.fields, name))
      .filter(score => typeof score === 'number' && !Number.isNaN(score));
    if (scores.length === 0) {
      return { name, accuracy: null };
    }
    return { name, accuracy: scores.reduce((sum, value) => sum + value, 0) / scores.length };
  });
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

export function calibrationMse(statedConfidence, hamming) {
  if (parseConfidence(statedConfidence) === null) {
    return null;
  }
  if (typeof hamming !== 'number' || Number.isNaN(hamming) || hamming < 0 || hamming > 1) {
    return null;
  }
  const residual = statedConfidence - hamming;
  return residual * residual;
}

const ZERO_DIVISION = 0;

export function fieldConfusion(fields, name) {
  const gold = fieldGold(fields, name);
  if (typeof gold !== 'boolean') {
    return null;
  }
  const predictedTrue = fieldPredicted(fields, name) === true;
  return {
    tp: gold && predictedTrue ? 1 : 0,
    fp: !gold && predictedTrue ? 1 : 0,
    fn: gold && !predictedTrue ? 1 : 0,
    tn: !gold && !predictedTrue ? 1 : 0
  };
}

function tokensFromNormalized(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return [];
  }
  const tokens = [];
  const seen = new Set();
  for (const part of value.split(',')) {
    const token = part.trim();
    if (!token || seen.has(token)) {
      continue;
    }
    seen.add(token);
    tokens.push(token);
  }
  return tokens;
}

function exampleClassConfusions(fields, name) {
  const gold = fieldGold(fields, name);
  if (typeof gold === 'boolean') {
    return { true: fieldConfusion(fields, name) };
  }
  if (typeof gold !== 'string') {
    return null;
  }
  const goldTokens = tokensFromNormalized(gold);
  if (goldTokens.length === 0) {
    return null;
  }
  const predicted = fieldPredicted(fields, name);
  const predTokens = tokensFromNormalized(typeof predicted === 'string' ? predicted : '');
  const goldSet = new Set(goldTokens);
  const predSet = new Set(predTokens);
  const classes = new Set([...goldTokens, ...predTokens]);
  const perClass = Object.create(null);
  for (const cls of classes) {
    const inGold = goldSet.has(cls);
    const inPred = predSet.has(cls);
    perClass[cls] = {
      tp: inGold && inPred ? 1 : 0,
      fp: !inGold && inPred ? 1 : 0,
      fn: inGold && !inPred ? 1 : 0,
      tn: !inGold && !inPred ? 1 : 0
    };
  }
  return perClass;
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
  const names = inferBooleanFieldNames(results, fieldNames);
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

function poolFieldClassConfusion(results, fieldNames = []) {
  const names = fieldNames.length > 0 ? fieldNames : inferFieldNamesFromResults(results);
  const pooled = Object.create(null);
  for (const name of names) {
    pooled[name] = Object.create(null);
  }
  for (const result of asResultList(results)) {
    for (const name of names) {
      const perClass = exampleClassConfusions(result.quantitative?.fields, name);
      if (!perClass) {
        continue;
      }
      for (const [cls, confusion] of Object.entries(perClass)) {
        if (!pooled[name][cls]) {
          pooled[name][cls] = emptyConfusion();
        }
        addConfusion(pooled[name][cls], confusion);
      }
    }
  }
  return { names, pooled };
}

function meanOf(values) {
  const scores = values.filter(score => typeof score === 'number' && !Number.isNaN(score));
  if (scores.length === 0) {
    return null;
  }
  return scores.reduce((sum, value) => sum + value, 0) / scores.length;
}

function metricsFromClassPooled(classPooled) {
  const classes = Object.keys(classPooled);
  if (classes.length === 0) {
    return { precision: null, recall: null, f1: null };
  }
  return {
    precision: meanOf(classes.map(cls => precisionFromConfusion(classPooled[cls]))),
    recall: meanOf(classes.map(cls => recallFromConfusion(classPooled[cls]))),
    f1: meanOf(classes.map(cls => f1FromConfusion(classPooled[cls])))
  };
}

export function macroF1FromResults(results, fieldNames = []) {
  const names = fieldNames.length > 0 ? fieldNames : inferFieldNamesFromResults(results);
  if (names.length === 0) {
    return null;
  }
  const { pooled } = poolFieldClassConfusion(results, names);
  const scores = names
    .map(name => metricsFromClassPooled(pooled[name]).f1)
    .filter(score => typeof score === 'number' && !Number.isNaN(score));
  if (scores.length === 0) {
    return null;
  }
  return scores.reduce((sum, value) => sum + value, 0) / scores.length;
}

export function perFieldClassification(results, fieldNames = []) {
  const names = fieldNames.length > 0 ? fieldNames : inferFieldNamesFromResults(results);
  const { pooled } = poolFieldClassConfusion(results, names);
  const accuracyByName = Object.fromEntries(
    perFieldAccuracy(results, names).map(row => [row.name, row.accuracy])
  );
  return names.map(name => {
    const metrics = metricsFromClassPooled(pooled[name]);
    return {
      name,
      precision: metrics.precision,
      recall: metrics.recall,
      f1: metrics.f1,
      accuracy: accuracyByName[name] ?? null
    };
  });
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

export function loadFieldNamesFromSuite() {
  const directories = CONFIGURATION.directories;
  return fieldNamesFromSuite({
    root: directories.root,
    schemasDir: directories.schemas,
    labelsDir: directories.labels
  });
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
  const fields = resolveFieldNames(results);
  return {
    bucket: results.some(result => result?.quantitative?.bucket),
    format_valid: results.some(result => result?.quantitative?.format_valid !== undefined),
    derived_confidence: results.some(result =>
      (typeof result?.quantitative?.confidence_exact === 'number' &&
        !Number.isNaN(result.quantitative.confidence_exact)) ||
      (typeof result?.quantitative?.confidence_hamming === 'number' &&
        !Number.isNaN(result.quantitative.confidence_hamming))
    ),
    kind: kinds.size > 1,
    fields,
    booleanFields: inferBooleanFieldNames(results, fields),
    hasF1: fields.length > 0
  };
}
