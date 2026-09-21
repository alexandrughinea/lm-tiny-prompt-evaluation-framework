import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  allocateStrata,
  meanNormalInterval,
  sampleSizeProportion,
  wilsonInterval,
  zFromConfidence
} from './stats.js';

test('zFromConfidence table', () => {
  assert.equal(zFromConfidence(0.95), 1.96);
  assert.equal(zFromConfidence(0.9), 1.645);
  assert.equal(zFromConfidence(0.99), 2.576);
  assert.throws(() => zFromConfidence(0.8), /Unknown confidence/);
});

test('sampleSizeProportion p=0.5 E=0.05 95% is 385', () => {
  assert.equal(sampleSizeProportion({ p: 0.5, moe: 0.05, confidence: 0.95 }), 385);
});

test('sampleSizeProportion finite population shrinks n', () => {
  const n = sampleSizeProportion({ p: 0.5, moe: 0.05, confidence: 0.95, N: 385 });
  assert.ok(n < 385);
  assert.equal(n, 193);
});

test('allocateStrata equal N gets equal n_h', () => {
  const rows = allocateStrata({
    n: 100,
    strata: [
      { stratum: 'a', N: 50 },
      { stratum: 'b', N: 50 }
    ]
  });
  assert.equal(rows[0].n, 50);
  assert.equal(rows[1].n, 50);
});

test('wilsonInterval contains p-hat and stays in (0,1)', () => {
  const successes = Math.round(385 * 0.9);
  const interval = wilsonInterval(385, successes, 0.95);
  assert.ok(interval.low > 0 && interval.high < 1);
  assert.ok(interval.low < 0.9 && interval.high > 0.9);
});

test('meanNormalInterval empty when n < 2', () => {
  assert.equal(meanNormalInterval([0.5], 0.95), null);
  const interval = meanNormalInterval([1, 0.5], 0.95);
  assert.ok(interval.low <= 0.75 && interval.high >= 0.75);
});
