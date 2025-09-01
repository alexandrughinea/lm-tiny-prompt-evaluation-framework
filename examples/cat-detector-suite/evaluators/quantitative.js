import { scoreField } from '../../../utils/report-utils.js';
import { BOOLEAN_FIELDS, SCHEMA_KEYS, isPlainObject, loadGoldLabel } from './labels.js';

function isBoolean(value) {
  return typeof value === 'boolean';
}

function isConfidence(value) {
  return typeof value === 'number' && !Number.isNaN(value) && value >= 0 && value <= 1;
}

function emptyFieldScores() {
  return Object.fromEntries(BOOLEAN_FIELDS.map(field => [field, {
    predicted: null,
    gold: null,
    correct: false
  }]));
}

/**
 * Score one model JSON against gold labels.
 *
 * @param {object} result Parsed model output
 * @param {{ input_data_file?: string }} [options]
 * @returns {{
 *   fields: Record<string, { predicted: unknown, gold: unknown, correct: boolean }>,
 *   format_valid: 0 | 1,
 *   bucket: string | null,
 *   errors: string[]
 * }}
 */
export function evaluateQuantitative(result, options = {}) {
  const metrics = {
    format_valid: 0,
    bucket: null,
    fields: emptyFieldScores(),
    errors: []
  };

  try {
    if (!isPlainObject(result) || (Object.hasOwn(result, 'raw_text') && !SCHEMA_KEYS.some(key => Object.hasOwn(result, key)))) {
      metrics.errors.push('Response is not a scene-audit JSON object');
      return metrics;
    }

    const resultKeys = Object.keys(result);
    const extraKeys = resultKeys.filter(key => !SCHEMA_KEYS.includes(key));
    const missingKeys = SCHEMA_KEYS.filter(key => !Object.hasOwn(result, key));
    const exactKeySet = extraKeys.length === 0 && missingKeys.length === 0;

    const schemaChecks = [
      ...BOOLEAN_FIELDS.map(field => isBoolean(result[field])),
      isConfidence(result.stated_confidence),
      exactKeySet
    ];

    if (extraKeys.length > 0) {
      metrics.errors.push(`Extra keys: ${extraKeys.join(', ')}`);
    }
    if (missingKeys.length > 0) {
      metrics.errors.push(`Missing keys: ${missingKeys.join(', ')}`);
    }
    for (const field of BOOLEAN_FIELDS) {
      if (Object.hasOwn(result, field) && !isBoolean(result[field])) {
        metrics.errors.push(`${field} must be a boolean`);
      }
    }
    if (Object.hasOwn(result, 'stated_confidence') && !isConfidence(result.stated_confidence)) {
      metrics.errors.push('stated_confidence must be a number between 0 and 1');
    }

    const brokeBothFelids = result.domestic_cat === true && result.wildlife_felid === true;
    if (brokeBothFelids) {
      metrics.errors.push('Consistency: domestic_cat and wildlife_felid cannot both be true');
    }

    const schemaOk = schemaChecks.every(Boolean);
    metrics.format_valid = schemaOk && !brokeBothFelids ? 1 : 0;

    const { label, error } = loadGoldLabel(options.input_data_file);
    if (error) {
      metrics.errors.push(error);
      return metrics;
    }

    metrics.bucket = label.bucket || null;

    for (const field of BOOLEAN_FIELDS) {
      metrics.fields[field] = scoreField(result[field], label[field]);
    }

    return metrics;
  } catch (error) {
    metrics.errors.push(error.message);
    return metrics;
  }
}
