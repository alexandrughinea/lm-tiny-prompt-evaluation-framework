process.env.INPUT_EXPERIMENT = 'qc-fixture-suite';
for (const key of [
  'INPUT_DATA_DIR',
  'INPUT_PROMPTS_DIR',
  'INPUT_SCHEMAS_DIR',
  'INPUT_EVALUATORS_DIR',
  'INPUT_ANNOTATIONS_DIR',
  'INPUT_LABELS_DIR'
]) {
  process.env[key] = '';
}

import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const {
  listJsonStems,
  parseArgs,
  qcIntervals,
  runQc,
  splitIds,
  writeQcMetricsCsv
} = await import('./qc-production.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qc-production-'));
}

await test('parseArgs', () => {
  const args = parseArgs(['--predictions', '/tmp/pred', '--model-name', 'moderator', '--confidence', '0.99', '--strict']);
  assert.ok(args.predictions.endsWith('pred'));
  assert.equal(args.modelName, 'moderator');
  assert.equal(args.confidence, 0.99);
  assert.equal(args.strict, true);
});

await test('splitIds and listJsonStems on fixture', () => {
  const pred = listJsonStems(path.join('examples', 'qc-fixture-suite', 'predictions'));
  const gold = listJsonStems(path.join('examples', 'qc-fixture-suite', 'labels'));
  const split = splitIds(pred, gold);
  assert.deepEqual(split.scored, ['case_miss', 'case_ok']);
  assert.deepEqual(split.unmatchedPredictions, ['orphan']);
});

await test('qcIntervals Wilson and Hamming CI at n=2', () => {
  const intervals = qcIntervals([
    { quantitative: { exact_match: 1, hamming_accuracy: 1 } },
    { quantitative: { exact_match: 0, hamming_accuracy: 0.5 } }
  ], 0.95);
  assert.equal(intervals.n, 2);
  assert.equal(intervals.exact_match, 0.5);
  assert.equal(intervals.hamming_accuracy, 0.75);
  assert.ok(intervals.exact_match_ci.low <= 0.5 && intervals.exact_match_ci.high >= 0.5);
  assert.ok(intervals.hamming_ci.low <= 0.75 && intervals.hamming_ci.high >= 0.75);
  const csv = writeQcMetricsCsv([{ task: { experiment: 'qc-fixture-suite' }, model: 'production' }], [], intervals);
  assert.match(csv, /exact_match_ci_low/);
  assert.match(csv, /hamming_ci_high/);
});

await test('runQc scores frozen predictions vs gold', async () => {
  const outDir = tmpDir();
  const { summary, results } = await runQc({ outDir, confidence: 0.95 });
  assert.equal(summary.n, 2);
  assert.equal(summary.exact_match, 0.5);
  assert.equal(summary.hamming_accuracy, 0.75);
  assert.deepEqual(summary.unmatchedPredictions, ['orphan']);
  assert.ok(summary.exact_match_ci);
  assert.ok(summary.hamming_ci);
  assert.equal(results.length, 2);
  assert.ok(fs.existsSync(path.join(outDir, 'results.csv')));
  assert.ok(fs.existsSync(path.join(outDir, 'metrics.csv')));
  assert.ok(fs.existsSync(path.join(outDir, 'qc.json')));
});

await test('runQc --strict fails on unmatched', async () => {
  await assert.rejects(
    () => runQc({ outDir: tmpDir(), strict: true }),
    /Unmatched files/
  );
});
