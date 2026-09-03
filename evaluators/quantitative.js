import fs from 'fs';
import path from 'path';
import { CONFIGURATION } from '../src/config.js';
import {
  loadScoringAliases,
  scoreFieldNormalized
} from '../utils/report-utils.js';
import {
  isPlainObject,
  loadFieldNames,
  loadGoldLabel
} from './labels.js';
import { enumsFromSchema } from '../utils/label-normalize.js';

function readSchema() {
  try {
    return JSON.parse(fs.readFileSync(
      path.join(CONFIGURATION.directories.schemas, 'response_format.schema.json'),
      'utf8'
    ));
  } catch {
    return null;
  }
}

function schemaKeys(schema, fieldNames) {
  if (Array.isArray(schema?.required) && schema.required.length > 0) {
    return schema.required;
  }
  if (isPlainObject(schema?.properties)) {
    return Object.keys(schema.properties);
  }
  return [...fieldNames];
}

function emptyFieldScores(fieldNames) {
  return Object.fromEntries(fieldNames.map(field => [field, {
    predicted: null,
    gold: null,
    correct: null
  }]));
}

export function evaluateQuantitative(result, options = {}) {
  const fieldNames = loadFieldNames();
  const aliases = loadScoringAliases();
  const schema = readSchema();
  const keys = schemaKeys(schema, fieldNames);
  const enums = enumsFromSchema(schema);

  const metrics = {
    format_valid: 0,
    bucket: null,
    fields: emptyFieldScores(fieldNames),
    errors: []
  };

  if (fieldNames.length === 0) {
    metrics.errors.push('No scorable fields (gold labels/, report.json, or schema)');
    return metrics;
  }

  try {
    if (!isPlainObject(result) || (Object.hasOwn(result, 'raw_text') && !keys.some(key => Object.hasOwn(result, key)))) {
      metrics.errors.push('Response is not a structured JSON object');
      return metrics;
    }

    const resultKeys = Object.keys(result);
    const extraKeys = resultKeys.filter(key => !keys.includes(key));
    const missingKeys = keys.filter(key => !Object.hasOwn(result, key));

    if (extraKeys.length > 0) {
      metrics.errors.push(`Extra keys: ${extraKeys.join(', ')}`);
    }
    if (missingKeys.length > 0) {
      metrics.errors.push(`Missing keys: ${missingKeys.join(', ')}`);
    }

    const exactKeySet = extraKeys.length === 0 && missingKeys.length === 0;
    metrics.format_valid = exactKeySet ? 1 : 0;

    const { label, error } = loadGoldLabel(options.input_data_file);
    if (error) {
      metrics.errors.push(error);
      return metrics;
    }

    metrics.bucket = label.bucket || null;

    for (const field of fieldNames) {
      metrics.fields[field] = scoreFieldNormalized(result[field], label[field], field, aliases, { enums });
    }

    return metrics;
  } catch (error) {
    metrics.errors.push(error.message);
    return metrics;
  }
}
