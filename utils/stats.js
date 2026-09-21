const Z_BY_CONFIDENCE = {
  0.9: 1.645,
  0.95: 1.96,
  0.99: 2.576
};

export function zFromConfidence(confidence) {
  const key = Number(confidence);
  const z = Z_BY_CONFIDENCE[key];
  if (z === undefined) {
    throw new Error(`Unknown confidence level: ${confidence} (use 0.90, 0.95, or 0.99)`);
  }
  return z;
}

export function sampleSizeProportion({ p, moe, confidence, N = null } = {}) {
  if (!(p >= 0 && p <= 1)) {
    throw new Error('p must be between 0 and 1');
  }
  if (!(moe > 0 && moe < 1)) {
    throw new Error('moe must be between 0 and 1');
  }
  const z = zFromConfidence(confidence);
  const n0 = Math.ceil((z * z * p * (1 - p)) / (moe * moe));
  if (N == null || N === '') {
    return n0;
  }
  const population = Number(N);
  if (!(population > 0)) {
    throw new Error('N must be a positive number');
  }
  return Math.ceil(n0 / (1 + (n0 - 1) / population));
}

export function allocateStrata({ n, strata }) {
  const totalN = strata.reduce((sum, row) => sum + Number(row.N), 0);
  if (!(totalN > 0)) {
    throw new Error('strata N must sum to a positive number');
  }
  return strata.map(row => {
    const size = Number(row.N);
    if (size <= 0) {
      return { stratum: row.stratum, N: size, n: 0 };
    }
    return {
      stratum: row.stratum,
      N: size,
      n: Math.max(1, Math.round(n * size / totalN))
    };
  });
}

export function wilsonInterval(n, successes, confidence) {
  if (!(n > 0)) {
    return null;
  }
  const z = zFromConfidence(confidence);
  const z2 = z * z;
  const p = successes / n;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin = z * Math.sqrt((p * (1 - p) / n) + z2 / (4 * n * n)) / denom;
  return {
    low: Math.max(0, center - margin),
    high: Math.min(1, center + margin)
  };
}

export function meanNormalInterval(values, confidence) {
  if (!Array.isArray(values) || values.length < 2) {
    return null;
  }
  const z = zFromConfidence(confidence);
  const n = values.length;
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1);
  const se = Math.sqrt(variance / n);
  return {
    low: mean - z * se,
    high: mean + z * se
  };
}
