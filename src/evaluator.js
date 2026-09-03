import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { CONFIGURATION } from './config.js';
import { brierScore, calibrationMse, exactFieldMatch, meanFieldMatch, parseConfidence } from '../utils/report-utils.js';
import { loadFieldNames } from '../evaluators/labels.js';
import { isPlainObject, rewriteRecordKeys } from '../utils/label-normalize.js';

const PROJECT_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @typedef {object} QuantitativeResult
 * @property {Record<string, { predicted: unknown, gold: unknown, correct: boolean }>} [fields]
 * @property {0|1} [format_valid]
 * @property {string|null} [bucket]
 * @property {string[]} [errors]
 * @property {number|null} [hamming_accuracy]
 * @property {number|null} [exact_match]
 * @property {number|null} [confidence_exact]
 * @property {number|null} [confidence_hamming]
 * @property {number|null} [brier_exact]
 * @property {number|null} [calibration_mse]
 */

/**
 * @typedef {object} QualitativeResult
 * @property {string[]} strengths
 * @property {string[]} weaknesses
 * @property {string[]} suggestions
 */

async function loadCustomEvaluator(type) {
  const functionName = type === 'quantitative' ? 'evaluateQuantitative' : 'evaluateQualitative';
  const candidates = [
    path.join(CONFIGURATION.directories.evaluators, `${type}.js`),
    path.join(PROJECT_ROOT, 'evaluators', `${type}.js`)
  ];

  for (const evaluatorPath of candidates) {
    try {
      await fs.access(evaluatorPath);
    } catch {
      continue;
    }

    try {
      const evaluatorModule = await import(`file://${evaluatorPath}`);
      if (evaluatorModule && typeof evaluatorModule[functionName] === 'function') {
        return evaluatorModule[functionName];
      }
    } catch (error) {
      console.error(`Error loading ${type} evaluator from ${evaluatorPath}:`, error);
    }
  }

  return null;
}

function asFormatValid(value) {
  if (value === true || value === 1) {
    return 1;
  }
  if (value === false || value === 0) {
    return 0;
  }
  return Number(value) === 1 ? 1 : 0;
}

/**
 * Run suite evaluators, then attach Hamming, exact match, brier_exact, and calibration_mse.
 * Confidence comes from harness self-consistency (`options.confidence_exact` / `confidence_hamming`), not from the model JSON.
 *
 * Suite `evaluateQuantitative(parsed, { input_data_file })` should return
 * `{ fields, format_valid?, bucket?, errors }`.
 * Suite `evaluateQualitative(parsed, { input_data_file })` should return
 * `{ strengths, weaknesses, suggestions }`.
 *
 * @param {object|string} result
 * @param {{ input_data_file?: string }} [options]
 */
export async function evaluate(result, options = {}) {
  let parsedResult = result;
  if (typeof result === "string") {
    try {
      parsedResult = JSON.parse(result);
    } catch {
      parsedResult = { raw_text: result };
    }
  }

  if (isPlainObject(parsedResult)) {
    parsedResult = rewriteRecordKeys(parsedResult, loadFieldNames());
  }

  const customQuantitative = await loadCustomEvaluator('quantitative');
  const customQualitative = await loadCustomEvaluator('qualitative');

  let quantitative = customQuantitative ?
    customQuantitative(parsedResult, options) :
    quantitativeEvaluation();

  const exactMatch = exactFieldMatch(quantitative.fields);
  const confidenceExact = parseConfidence(options.confidence_exact);
  const confidenceHamming = parseConfidence(options.confidence_hamming);
  quantitative = {
    ...quantitative,
    hamming_accuracy: meanFieldMatch(quantitative.fields),
    exact_match: exactMatch,
    errors: quantitative.errors || []
  };
  if (confidenceExact !== null) {
    quantitative.confidence_exact = confidenceExact;
    const exactBrier = brierScore(confidenceExact, exactMatch);
    if (exactBrier !== null) {
      quantitative.brier_exact = exactBrier;
    }
  }
  if (confidenceHamming !== null) {
    quantitative.confidence_hamming = confidenceHamming;
    const mse = calibrationMse(confidenceHamming, quantitative.hamming_accuracy);
    if (mse !== null) {
      quantitative.calibration_mse = mse;
    }
  }

  if (quantitative.format_valid !== undefined) {
    quantitative.format_valid = asFormatValid(quantitative.format_valid);
  }

  const qualitative = customQualitative ?
    customQualitative(parsedResult, options) :
    qualitativeEvaluation(parsedResult, options);

  return {
    quantitative,
    qualitative
  };
}

export function quantitativeEvaluation() {
  return {
    errors: []
  };
}

export function qualitativeEvaluation(result, options = {}) {
  const assessment = {
    strengths: [],
    weaknesses: [],
    suggestions: []
  };

  try {
    if (options.assessmentFn && typeof options.assessmentFn === 'function') {
      const customAssessment = options.assessmentFn(result, options);
      if (customAssessment) {
        Object.assign(assessment, customAssessment);
        return assessment;
      }
    }

    const expectedFields = options.expectedFields || [];

    for (const field of expectedFields) {
      const hasField = field.alternateNames.some(name => result[name] !== undefined);

      if (hasField) {
        assessment.strengths.push(`Contains ${field.description}`);
      } else {
        assessment.weaknesses.push(`Missing ${field.description}`);
      }
    }

    if (assessment.weaknesses.length > 0) {
      assessment.suggestions.push("Ensure all expected elements are included in the response");
    }

    if (assessment.strengths.length < Math.ceil(expectedFields.length / 2)) {
      assessment.suggestions.push("Provide more comprehensive information in the response");
    }
  } catch (error) {
    console.warn("Error in qualitative evaluation:", error.message);
    assessment.weaknesses.push("Error processing the response format");
    assessment.suggestions.push("Ensure response is properly formatted as requested");
  }

  return assessment;
}
