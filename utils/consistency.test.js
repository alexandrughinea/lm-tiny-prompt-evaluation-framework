import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selfConsistency } from './consistency.js';

const FIELDS = ['domestic_cat', 'person'];

test('N<2 yields the only sample and no confidence', () => {
  const voted = selfConsistency([{ domestic_cat: true, person: false }], FIELDS);
  assert.deepEqual(voted.prediction, { domestic_cat: true, person: false });
  assert.equal(voted.confidence_exact, null);
  assert.equal(voted.confidence_hamming, null);
});

test('per-field majority is the scored prediction', () => {
  const voted = selfConsistency([
    { domestic_cat: true, person: true },
    { domestic_cat: true, person: true },
    { domestic_cat: true, person: false },
    { domestic_cat: false, person: true },
    { domestic_cat: true, person: true }
  ], FIELDS);
  assert.deepEqual(voted.prediction, { domestic_cat: true, person: true });
  assert.equal(voted.confidence_hamming, 0.8);
  assert.equal(voted.confidence_exact, 0.6);
});

test('parse failures count against N and do not vote', () => {
  const voted = selfConsistency([
    { domestic_cat: true, person: false },
    { domestic_cat: true, person: false },
    null,
    { domestic_cat: false, person: false },
    { domestic_cat: true, person: false }
  ], FIELDS);
  assert.deepEqual(voted.prediction, { domestic_cat: true, person: false });
  assert.equal(voted.confidence_exact, 3 / 5);
  assert.equal(voted.confidence_hamming, (3 / 5 + 4 / 5) / 2);
});

test('strips stated_confidence off the majority JSON', () => {
  const voted = selfConsistency([
    { domestic_cat: true, person: false, stated_confidence: 0.9 },
    { domestic_cat: true, person: false, stated_confidence: 0.1 },
    { domestic_cat: true, person: false, stated_confidence: 0.5 }
  ], FIELDS);
  assert.equal(Object.hasOwn(voted.prediction, 'stated_confidence'), false);
  assert.equal(voted.confidence_exact, 1);
});
