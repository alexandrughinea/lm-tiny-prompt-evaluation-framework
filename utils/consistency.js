function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function voteKey(value) {
  if (value === undefined) {
    return null;
  }
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return `${typeof value}:${value}`;
  }
  return `j:${JSON.stringify(value)}`;
}

function parseVoteKey(key) {
  if (key.startsWith('boolean:')) {
    return key.slice('boolean:'.length) === 'true';
  }
  if (key.startsWith('number:')) {
    return Number(key.slice('number:'.length));
  }
  if (key.startsWith('string:')) {
    return key.slice('string:'.length);
  }
  if (key.startsWith('j:')) {
    return JSON.parse(key.slice(2));
  }
  return key;
}

function fieldVectorEquals(sample, prediction, fieldNames) {
  if (!isPlainObject(sample)) {
    return false;
  }
  return fieldNames.every(name => Object.is(sample[name], prediction[name]));
}

/**
 * Majority vote over N parsed model JSONs. Confidence is vote share, not a self-grade.
 *
 * `confidence_exact` = fraction of draws whose scored fields equal the majority vector.
 * `confidence_hamming` = mean over fields of that field’s majority vote share.
 * Parse failures are in the denominator and do not vote. N < 2 → no confidence.
 *
 * @param {Array<object|null|undefined>} samples
 * @param {string[]} fieldNames
 * @returns {{
 *   prediction: object,
 *   confidence_exact: number|null,
 *   confidence_hamming: number|null
 * }}
 */
export function selfConsistency(samples, fieldNames = []) {
  const n = Array.isArray(samples) ? samples.length : 0;
  const names = Array.isArray(fieldNames) ? fieldNames : [];
  const prediction = {};

  if (n === 0 || names.length === 0) {
    return { prediction, confidence_exact: null, confidence_hamming: null };
  }

  const valid = samples.filter(isPlainObject);

  for (const name of names) {
    const counts = Object.create(null);
    for (const sample of valid) {
      if (!Object.hasOwn(sample, name)) {
        continue;
      }
      const key = voteKey(sample[name]);
      if (key === null) {
        continue;
      }
      counts[key] = (counts[key] || 0) + 1;
    }
    const keys = Object.keys(counts);
    if (keys.length === 0) {
      continue;
    }
    keys.sort((a, b) => {
      const diff = counts[b] - counts[a];
      return diff !== 0 ? diff : a.localeCompare(b);
    });
    prediction[name] = parseVoteKey(keys[0]);
  }

  if (n < 2) {
    if (valid[0]) {
      for (const name of names) {
        if (Object.hasOwn(valid[0], name) && !Object.hasOwn(prediction, name)) {
          prediction[name] = valid[0][name];
        }
      }
    }
    return { prediction, confidence_exact: null, confidence_hamming: null };
  }

  const exactHits = samples.filter(sample => fieldVectorEquals(sample, prediction, names)).length;
  const fieldShares = names.map(name => {
    const target = prediction[name];
    const hits = samples.filter(sample =>
      isPlainObject(sample) && Object.hasOwn(sample, name) && Object.is(sample[name], target)
    ).length;
    return hits / n;
  });
  const confidenceHamming = fieldShares.reduce((sum, value) => sum + value, 0) / names.length;

  return {
    prediction,
    confidence_exact: exactHits / n,
    confidence_hamming: confidenceHamming
  };
}
