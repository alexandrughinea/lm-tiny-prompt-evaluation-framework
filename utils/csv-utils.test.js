import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getCSVColumns, getCSVDataMap, getMetricsColumns, writeMetricsCsv } from './csv-utils.js';

test('identity columns put system and user prompts after prompt_name', () => {
  const columns = getCSVColumns(['field_a']);
  const promptName = columns.indexOf('prompt_name');
  assert.equal(columns[promptName + 1], 'input_system_prompt');
  assert.equal(columns[promptName + 2], 'input_user_prompt');
  assert.equal(columns[promptName + 3], 'input_data_file');
});

test('getCSVDataMap copies prompt stems from a framework result', () => {
  const row = getCSVDataMap({
    id: 'm-user_v1-case.txt',
    timestamp: '2026-01-01T00:00:00.000Z',
    model: 'm',
    prompt_name: 'v1',
    task: { experiment: 'demo', prompt_name: 'v1' },
    input_system_prompt: 'system_v1',
    input_user_prompt: 'user_v1',
    input_data_file: 'case.txt',
    input_kind: 'text',
    quantitative: { hamming_accuracy: 1, exact_match: 1 }
  });
  assert.equal(row.prompt_name, 'v1');
  assert.equal(row.input_system_prompt, 'system_v1');
  assert.equal(row.input_user_prompt, 'user_v1');
  assert.equal(row.input_data_file, 'case.txt');
});

test('getCSVDataMap leaves missing prompt stems empty', () => {
  const row = getCSVDataMap({
    model: 'production',
    prompt_name: 'production',
    task: { experiment: 'qc', prompt_name: 'production' },
    input_data_file: 'case_ok'
  });
  assert.equal(row.input_system_prompt, '');
  assert.equal(row.input_user_prompt, '');
});

test('results and metrics keep Hamming and emit derived confidence then residuals', () => {
  const resultColumns = getCSVColumns(['field_a']);
  assert.ok(resultColumns.includes('hamming_accuracy'));
  assert.equal(resultColumns[resultColumns.indexOf('exact_match') + 1], 'confidence_exact');
  assert.equal(resultColumns[resultColumns.indexOf('exact_match') + 2], 'confidence_hamming');
  assert.equal(resultColumns[resultColumns.indexOf('confidence_hamming') + 1], 'brier_exact');
  assert.equal(resultColumns[resultColumns.indexOf('brier_exact') + 1], 'calibration_mse');
  assert.equal(resultColumns.includes('stated_confidence'), false);
  assert.equal(resultColumns.includes('brier'), false);

  const metricColumns = getMetricsColumns(['field_a']);
  assert.ok(metricColumns.includes('hamming_accuracy'));
  assert.ok(metricColumns.includes('mean_confidence_exact'));
  assert.ok(metricColumns.includes('mean_confidence_hamming'));
  assert.equal(metricColumns[metricColumns.indexOf('mean_confidence_exact') + 1], 'mean_confidence_hamming');
  assert.equal(metricColumns[metricColumns.indexOf('mean_confidence_hamming') + 1], 'brier_exact');
  assert.equal(metricColumns.includes('mean_stated_confidence'), false);
  assert.equal(metricColumns.includes('brier'), false);
});

test('writeMetricsCsv means per-case calibration_mse not square of mean diffs', () => {
  const csv = writeMetricsCsv([
    {
      model: 'm1',
      task: { experiment: 'demo' },
      quantitative: {
        fields: { a: { predicted: true, gold: true, correct: true } },
        hamming_accuracy: 0.75,
        exact_match: 0,
        confidence_exact: 1,
        confidence_hamming: 1,
        brier_exact: 1,
        calibration_mse: 0.0625
      }
    },
    {
      model: 'm1',
      task: { experiment: 'demo' },
      quantitative: {
        fields: { a: { predicted: false, gold: true, correct: false } },
        hamming_accuracy: 0.25,
        exact_match: 0,
        confidence_exact: 1,
        confidence_hamming: 1,
        brier_exact: 1,
        calibration_mse: 0.5625
      }
    }
  ], ['a']);
  const header = csv.split('\n')[0].split(',');
  const row = csv.split('\n')[1].split(',');
  assert.equal(row[header.indexOf('hamming_accuracy')], '0.5000');
  assert.equal(row[header.indexOf('brier_exact')], '1.0000');
  assert.equal(row[header.indexOf('calibration_mse')], '0.3125');
});

test('getCSVDataMap writes Hamming plus both residuals', () => {
  const row = getCSVDataMap({
    id: 'm-user_v1-case.txt',
    timestamp: '2026-01-01T00:00:00.000Z',
    model: 'm',
    prompt_name: 'v1',
    task: { experiment: 'demo', prompt_name: 'v1' },
    input_data_file: 'case.txt',
    quantitative: {
      hamming_accuracy: 0.8,
      exact_match: 0,
      confidence_exact: 0.6,
      confidence_hamming: 0.8,
      brier_exact: 0.81,
      calibration_mse: 0.01
    }
  });
  assert.equal(row.hamming_accuracy, '0.8000');
  assert.equal(row.confidence_exact, '0.6000');
  assert.equal(row.confidence_hamming, '0.8000');
  assert.equal(row.brier_exact, '0.8100');
  assert.equal(row.calibration_mse, '0.0100');
  assert.equal(row.stated_confidence, undefined);
});

test('metrics columns include macro_f1 and per-field P/R/F1 for string suites', () => {
  const columns = getMetricsColumns(['subject_type']);
  assert.ok(columns.includes('macro_f1'));
  assert.ok(columns.includes('precision_subject_type'));
  assert.ok(columns.includes('recall_subject_type'));
  assert.ok(columns.includes('f1_subject_type'));
  assert.ok(columns.includes('accuracy_subject_type'));
});

test('writeMetricsCsv emits f1 for string fields', () => {
  const csv = writeMetricsCsv([
    {
      model: 'm1',
      task: { experiment: 'demo' },
      quantitative: {
        fields: {
          subject_type: {
            predicted: 'real content',
            gold: 'real content',
            correct: true
          }
        },
        hamming_accuracy: 1,
        exact_match: 1
      }
    }
  ], ['subject_type']);
  assert.match(csv, /macro_f1/);
  assert.match(csv, /f1_subject_type/);
  const header = csv.split('\n')[0];
  const row = csv.split('\n')[1];
  const f1Index = header.split(',').indexOf('f1_subject_type');
  assert.equal(row.split(',')[f1Index], '1.0000');
});
