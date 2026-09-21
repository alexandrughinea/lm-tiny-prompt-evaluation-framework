import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { detectDelimiter, parseCsv } from '../utils/csv-io.js';
import { allocateStrata, sampleSizeProportion } from '../utils/stats.js';

export function parseArgs(argv) {
  const args = {
    confidence: 0.95,
    moe: 0.05,
    p: 0.5,
    N: null,
    strata: null,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--confidence' && argv[i + 1]) {
      args.confidence = Number(argv[i + 1]);
      i += 1;
    } else if (token === '--moe' && argv[i + 1]) {
      args.moe = Number(argv[i + 1]);
      i += 1;
    } else if (token === '--p' && argv[i + 1]) {
      args.p = Number(argv[i + 1]);
      i += 1;
    } else if (token === '--N' && argv[i + 1]) {
      args.N = Number(argv[i + 1]);
      i += 1;
    } else if (token === '--strata' && argv[i + 1]) {
      args.strata = path.resolve(argv[i + 1]);
      i += 1;
    } else if (token === '--help' || token === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  return args;
}

export function printHelp() {
  console.log(`Compute review sample size n from confidence and margin of error.

Usage:
  npm run sample-size -- [--confidence 0.95] [--moe 0.05] [--p 0.5] [--N POP] [--strata file.csv]

--p is guessed accuracy (use 0.5 if unknown). This is not model stated_confidence.
--strata CSV columns: stratum,N and optional p. Allocates n proportionally.
`);
}

function optionalNumber(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseStrataRows(text) {
  const rows = parseCsv(text, { delimiter: detectDelimiter(text) });
  return rows.map(row => {
    const stratum = String(row.stratum ?? row.Stratum ?? '').trim();
    const N = optionalNumber(row.N ?? row.n_pop ?? row.population);
    const p = optionalNumber(row.p);
    if (!stratum || N == null) {
      throw new Error('strata CSV needs stratum and N columns');
    }
    return { stratum, N, p };
  });
}

export function pooledP(fallbackP, strata) {
  if (!strata.length) {
    return fallbackP;
  }
  const withP = strata.filter(row => row.p != null);
  if (withP.length === 0) {
    return fallbackP;
  }
  const totalN = withP.reduce((sum, row) => sum + row.N, 0);
  return withP.reduce((sum, row) => sum + row.N * row.p, 0) / totalN;
}

export function computeSampleSize({ confidence, moe, p, N, strata }) {
  const list = Array.isArray(strata) ? strata : [];
  const totalN = list.length > 0
    ? list.reduce((sum, row) => sum + row.N, 0)
    : N;
  const usedP = pooledP(p, list);
  const n = sampleSizeProportion({
    p: usedP,
    moe,
    confidence,
    N: totalN
  });
  const allocated = list.length > 0 ? allocateStrata({ n, strata: list }) : [];

  return {
    confidence,
    moe,
    p: usedP,
    N: totalN ?? null,
    n,
    strata: allocated
  };
}

function formatTable(result) {
  const lines = [
    `n=${result.n}  confidence=${result.confidence}  moe=${result.moe}  p=${result.p}` +
      (result.N != null ? `  N=${result.N}` : '')
  ];
  if (result.strata.length > 0) {
    lines.push('stratum\tN\tn');
    for (const row of result.strata) {
      lines.push(`${row.stratum}\t${row.N}\t${row.n}`);
    }
  }
  return lines.join('\n');
}

export function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return null;
  }
  let strata = [];
  if (args.strata) {
    strata = parseStrataRows(fs.readFileSync(args.strata, 'utf8'));
  }
  const result = computeSampleSize({
    confidence: args.confidence,
    moe: args.moe,
    p: args.p,
    N: args.N,
    strata
  });
  console.log(formatTable(result));
  console.log(JSON.stringify(result, null, 2));
  return result;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  try {
    run();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
