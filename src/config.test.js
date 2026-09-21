import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readSuiteSettings } from '../src/config.js';

test('nested model and eval.repeats win', () => {
  const settings = readSuiteSettings({
    model: {
      temperature: 0.7,
      top_p: 0.9,
      max_tokens: 1000,
      structured_output: false
    },
    eval: { repeats: 3 },
    temperature: 0,
    consistency_n: 9,
    use_structured_output: true
  }, {});
  assert.equal(settings.temperature, 0.7);
  assert.equal(settings.top_p, 0.9);
  assert.equal(settings.max_tokens, 1000);
  assert.equal(settings.structuredOutput, false);
  assert.equal(settings.evalRepeats, 3);
});

test('flat keys still load', () => {
  const settings = readSuiteSettings({
    temperature: 0.4,
    top_p: 0.8,
    max_tokens: 2000,
    consistency_n: 4,
    use_structured_output: false
  }, {});
  assert.equal(settings.temperature, 0.4);
  assert.equal(settings.top_p, 0.8);
  assert.equal(settings.max_tokens, 2000);
  assert.equal(settings.structuredOutput, false);
  assert.equal(settings.evalRepeats, 4);
});

test('defaults when config is empty', () => {
  const settings = readSuiteSettings({}, {});
  assert.equal(settings.temperature, 0.7);
  assert.equal(settings.top_p, 0.95);
  assert.equal(settings.max_tokens, 30000);
  assert.equal(settings.structuredOutput, true);
  assert.equal(settings.evalRepeats, 3);
});

test('env fills gaps when keys are omitted', () => {
  const settings = readSuiteSettings({}, {
    TEMPERATURE: '0.2',
    CONSISTENCY_N: '8',
    USE_STRUCTURED_OUTPUT_SCHEMA: 'false'
  });
  assert.equal(settings.temperature, 0.2);
  assert.equal(settings.evalRepeats, 8);
  assert.equal(settings.structuredOutput, false);
});
