import { BOOLEAN_FIELDS, SCHEMA_KEYS, isPlainObject, loadGoldLabel } from './labels.js';

/**
 * Notes only — gold bucket, gold flags, consistency nits.
 *
 * @param {object} result Parsed model output
 * @param {{ input_data_file?: string }} [options]
 * @returns {{ strengths: string[], weaknesses: string[], suggestions: string[] }}
 */
export function evaluateQualitative(result, options = {}) {
  const assessment = {
    strengths: [],
    weaknesses: [],
    suggestions: []
  };

  try {
    const { label, error } = loadGoldLabel(options.input_data_file);
    if (error) {
      assessment.weaknesses.push(error);
      assessment.suggestions.push('Add a matching labels/{basename}.json file for this case');
      return assessment;
    }

    if (label.bucket) {
      assessment.strengths.push(`Bucket: ${label.bucket}`);
    }
    const goldFlags = BOOLEAN_FIELDS
      .map(name => `${name}=${label[name] === true ? 'true' : 'false'}`)
      .join(', ');
    assessment.strengths.push(`Gold: ${goldFlags}`);

    if (!isPlainObject(result) || (Object.hasOwn(result, 'raw_text') && !SCHEMA_KEYS.some(key => Object.hasOwn(result, key)))) {
      assessment.weaknesses.push('Response is not a scene-audit JSON object');
      assessment.suggestions.push('Return only the five schema keys as JSON');
      return assessment;
    }

    if (result.domestic_cat === true && result.wildlife_felid === true) {
      assessment.weaknesses.push('domestic_cat and wildlife_felid cannot both be true');
    }

    if (assessment.weaknesses.length > 0) {
      assessment.suggestions.push('Re-check the image against the field rules and the gold flags');
    }
  } catch (error) {
    assessment.weaknesses.push(`Error processing the response: ${error.message}`);
    assessment.suggestions.push('Ensure response is valid scene-audit JSON');
  }

  return assessment;
}
