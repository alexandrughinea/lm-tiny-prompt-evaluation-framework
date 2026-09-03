import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeSampleSize, parseArgs, parseStrataRows } from './sample-size.js';

test('parseArgs defaults and flags', () => {
  const defaults = parseArgs([]);
  assert.equal(defaults.confidence, 0.95);
  assert.equal(defaults.moe, 0.05);
  assert.equal(defaults.p, 0.5);
  assert.equal(defaults.N, null);
  assert.equal(defaults.strata, null);

  const args = parseArgs([
    '--confidence', '0.99',
    '--moe', '0.03',
    '--p', '0.9',
    '--N', '12000',
    '--strata', '/tmp/strata.csv'
  ]);
  assert.equal(args.confidence, 0.99);
  assert.equal(args.moe, 0.03);
  assert.equal(args.p, 0.9);
  assert.equal(args.N, 12000);
  assert.ok(args.strata.endsWith('strata.csv'));
});

test('computeSampleSize without strata', () => {
  const result = computeSampleSize({
    confidence: 0.95,
    moe: 0.05,
    p: 0.5,
    N: null,
    strata: []
  });
  assert.equal(result.n, 385);
  assert.equal(result.p, 0.5);
  assert.deepEqual(result.strata, []);
});

test('computeSampleSize strata proportional allocation', () => {
  const result = computeSampleSize({
    confidence: 0.95,
    moe: 0.05,
    p: 0.5,
    N: null,
    strata: [
      { stratum: 'a', N: 50 },
      { stratum: 'b', N: 50 }
    ]
  });
  assert.equal(result.N, 100);
  assert.ok(result.n < 385);
  assert.equal(result.strata[0].n, result.strata[1].n);
});

test('parseStrataRows reads N and optional p', () => {
  const rows = parseStrataRows('stratum,N,p\na,10,0.8\nb,30,\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].stratum, 'a');
  assert.equal(rows[0].N, 10);
  assert.equal(rows[0].p, 0.8);
  assert.equal(rows[1].p, null);
});

test('weighted p from strata when present', () => {
  const result = computeSampleSize({
    confidence: 0.95,
    moe: 0.05,
    p: 0.5,
    N: null,
    strata: [
      { stratum: 'a', N: 50, p: 0.9 },
      { stratum: 'b', N: 50, p: 0.7 }
    ]
  });
  assert.equal(result.p, 0.8);
});
