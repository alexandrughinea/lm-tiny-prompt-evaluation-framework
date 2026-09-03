import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CONFIGURATION } from '../src/config.js';
import { evaluate } from '../src/evaluator.js';
import { loadFieldNames } from '../evaluators/labels.js';
import { caseIdFromValue } from '../utils/label-normalize.js';
import {
  CSV_FORMAT,
  escapeCSV,
  getCSVColumns,
  getCSVColumnsJoined,
  getCSVDataMap
} from '../utils/csv-utils.js';
import { meanNormalInterval, wilsonInterval, zFromConfidence } from '../utils/stats.js';

export function parseArgs(argv) {
  const args = {
    predictions: null,
    modelName: 'production',
    confidence: 0.95,
    strict: false,
    out: null,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--predictions' && argv[i + 1]) {
      args.predictions = path.resolve(argv[i + 1]);
      i += 1;
    } else if (token === '--model-name' && argv[i + 1]) {
      args.modelName = argv[i + 1];
      i += 1;
    } else if (token === '--confidence' && argv[i + 1]) {
      args.confidence = Number(argv[i + 1]);
      i += 1;
    } else if (token === '--out' && argv[i + 1]) {
      args.out = path.resolve(argv[i + 1]);
      i += 1;
    } else if (token === '--strict') {
      args.strict = true;
    } else if (token === '--help' || token === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  return args;
}

export function printHelp() {
  console.log(`Score frozen production labels against gold. Does not call the model server.

Usage:
  npm run qc -- [--predictions DIR] [--model-name production] [--confidence 0.95] [--out DIR] [--strict]

Default predictions dir is {suite}/predictions/. Gold is {suite}/labels/.
Statistical --confidence is not stated_confidence.
`);
}

export function listJsonStems(dir) {
  if (!dir || !fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir)
    .filter(name => name.endsWith('.json') && !name.startsWith('_'))
    .map(name => caseIdFromValue(name))
    .sort();
}

export function splitIds(predictionIds, goldIds) {
  const goldSet = new Set(goldIds);
  const predSet = new Set(predictionIds);
  return {
    scored: predictionIds.filter(id => goldSet.has(id)),
    unmatchedPredictions: predictionIds.filter(id => !goldSet.has(id)),
    unmatchedGold: goldIds.filter(id => !predSet.has(id))
  };
}

function formatScore(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '';
  }
  return value.toFixed(4);
}

function intervalFields(interval) {
  if (!interval) {
    return { low: '', high: '' };
  }
  return { low: formatScore(interval.low), high: formatScore(interval.high) };
}

export function qcIntervals(results, confidence) {
  zFromConfidence(confidence);
  const exactBits = results
    .map(result => result.quantitative?.exact_match)
    .filter(value => value === 0 || value === 1 || value === true || value === false);
  const n = exactBits.length;
  const successes = exactBits.filter(value => value === 1 || value === true).length;
  const hammingValues = results
    .map(result => result.quantitative?.hamming_accuracy)
    .filter(value => typeof value === 'number' && !Number.isNaN(value));
  const exactMean = n === 0 ? null : successes / n;
  const hammingMean = hammingValues.length === 0
    ? null
    : hammingValues.reduce((sum, value) => sum + value, 0) / hammingValues.length;

  return {
    n,
    exact_match: exactMean,
    hamming_accuracy: hammingMean,
    exact_match_ci: n > 0 ? wilsonInterval(n, successes, confidence) : null,
    hamming_ci: meanNormalInterval(hammingValues, confidence),
    confidence
  };
}

export function writeQcMetricsCsv(results, fieldNames, intervals) {
  const exactCi = intervalFields(intervals.exact_match_ci);
  const hammingCi = intervalFields(intervals.hamming_ci);
  const columns = [
    'experiment',
    'model',
    'n',
    'hamming_accuracy',
    'hamming_ci_low',
    'hamming_ci_high',
    'exact_match',
    'exact_match_ci_low',
    'exact_match_ci_high',
    'confidence'
  ];
  const experiment = results[0]?.task?.experiment || '';
  const model = results[0]?.model || 'production';
  const row = {
    experiment,
    model,
    n: String(intervals.n),
    hamming_accuracy: formatScore(intervals.hamming_accuracy),
    hamming_ci_low: hammingCi.low,
    hamming_ci_high: hammingCi.high,
    exact_match: formatScore(intervals.exact_match),
    exact_match_ci_low: exactCi.low,
    exact_match_ci_high: exactCi.high,
    confidence: formatScore(intervals.confidence)
  };
  let csv = columns.join(CSV_FORMAT.COMMA) + CSV_FORMAT.NEW_LINE;
  csv += columns.map(column => escapeCSV(row[column] ?? '')).join(CSV_FORMAT.COMMA) + CSV_FORMAT.NEW_LINE;
  return csv;
}

function writeResultsCsv(results, fieldNames) {
  let csv = getCSVColumnsJoined(fieldNames) + CSV_FORMAT.NEW_LINE;
  for (const result of results) {
    const dataMap = getCSVDataMap(result, fieldNames);
    csv += getCSVColumns(fieldNames).map(field => escapeCSV(dataMap[field])).join(CSV_FORMAT.COMMA) + CSV_FORMAT.NEW_LINE;
  }
  return csv;
}

function qcStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export async function runQc(options = {}) {
  const predictionsDir = options.predictionsDir
    || path.join(CONFIGURATION.directories.root, 'predictions');
  const labelsDir = CONFIGURATION.directories.labels;
  const modelName = options.modelName || 'production';
  const confidence = options.confidence ?? 0.95;
  const strict = Boolean(options.strict);
  const outDir = options.outDir
    || path.join(CONFIGURATION.directories.results, `qc_${qcStamp()}`);

  const predictionIds = listJsonStems(predictionsDir);
  const goldIds = listJsonStems(labelsDir);
  const { scored, unmatchedPredictions, unmatchedGold } = splitIds(predictionIds, goldIds);

  if (strict && (unmatchedPredictions.length > 0 || unmatchedGold.length > 0)) {
    throw new Error(
      `Unmatched files (strict): predictions=${unmatchedPredictions.join(',') || '-'} gold=${unmatchedGold.join(',') || '-'}`
    );
  }

  const timestamp = new Date().toISOString();
  const fieldNames = loadFieldNames();
  const results = [];

  for (const id of scored) {
    const prediction = JSON.parse(fs.readFileSync(path.join(predictionsDir, `${id}.json`), 'utf8'));
    const { quantitative, qualitative } = await evaluate(prediction, { input_data_file: id });
    results.push({
      id: `${modelName}-${id}`,
      timestamp,
      model: modelName,
      prompt_name: 'production',
      task: {
        experiment: CONFIGURATION.experiment,
        prompt_name: 'production'
      },
      input_data_file: id,
      input_kind: 'production',
      quantitative,
      qualitative,
      processing_time: null
    });
  }

  const intervals = qcIntervals(results, confidence);
  const summary = {
    experiment: CONFIGURATION.experiment,
    model: modelName,
    predictionsDir,
    labelsDir,
    n: intervals.n,
    unmatchedPredictions,
    unmatchedGold,
    hamming_accuracy: intervals.hamming_accuracy,
    hamming_ci: intervals.hamming_ci,
    exact_match: intervals.exact_match,
    exact_match_ci: intervals.exact_match_ci,
    confidence: intervals.confidence,
    outDir
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'results.csv'), writeResultsCsv(results, fieldNames));
  fs.writeFileSync(path.join(outDir, 'metrics.csv'), writeQcMetricsCsv(results, fieldNames, intervals));
  fs.writeFileSync(path.join(outDir, 'qc.json'), `${JSON.stringify(summary, null, 2)}\n`);

  return { results, summary, outDir };
}

export async function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return null;
  }
  const { summary, outDir } = await runQc({
    predictionsDir: args.predictions,
    modelName: args.modelName,
    confidence: args.confidence,
    strict: args.strict,
    outDir: args.out
  });
  for (const id of summary.unmatchedPredictions) {
    console.warn(`Unmatched prediction (no gold): ${id}`);
  }
  for (const id of summary.unmatchedGold) {
    console.warn(`Unmatched gold (no prediction): ${id}`);
  }
  console.log(`QC n=${summary.n} exact_match=${summary.exact_match} → ${outDir}`);
  console.log(JSON.stringify({
    n: summary.n,
    exact_match: summary.exact_match,
    exact_match_ci: summary.exact_match_ci,
    hamming_accuracy: summary.hamming_accuracy,
    hamming_ci: summary.hamming_ci,
    confidence: summary.confidence
  }, null, 2));
  return summary;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  run().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}
