import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  brierScore,
  calibrationMse,
  exactFieldMatch,
  fieldConfusion,
  inferBooleanFieldNames,
  macroF1FromResults,
  meanFieldMatch,
  perFieldAccuracy,
  perFieldClassification,
  scoreFieldNormalized
} from './report-utils.js';
import { generateReport } from '../src/framework.js';

function resultWithFields(fields) {
  return { quantitative: { fields } };
}

function scored(predicted, gold) {
  return {
    predicted,
    gold,
    correct: predicted !== null && gold !== null && Object.is(predicted, gold)
  };
}

test('macroF1FromResults averages class-macro F1 for string fields', () => {
  const results = [
    resultWithFields({ subject_type: scored('real content', 'real content') }),
    resultWithFields({ subject_type: scored('cartoon-anime', 'real content') })
  ];
  assert.deepEqual(inferBooleanFieldNames(results, ['subject_type']), []);
  assert.equal(macroF1FromResults(results, ['subject_type']), 1 / 3);
});

test('macroF1FromResults averages boolean label F1', () => {
  const results = [
    resultWithFields({ domestic_cat: scored(true, true) }),
    resultWithFields({ domestic_cat: scored(false, true) })
  ];
  const f1 = macroF1FromResults(results, ['domestic_cat']);
  assert.equal(f1, 2 / 3);
});

test('perFieldClassification reports class-macro P/R/F1 and exact-set accuracy for strings', () => {
  const results = [
    resultWithFields({ subject_type: scored('real content', 'real content') }),
    resultWithFields({ subject_type: scored('other', 'real content') })
  ];
  const [row] = perFieldClassification(results, ['subject_type']);
  assert.equal(row.precision, 0.5);
  assert.equal(row.recall, 0.25);
  assert.equal(row.f1, 1 / 3);
  assert.equal(row.accuracy, 0.5);
});

test('multi-select strings match regardless of token order', () => {
  const scoredField = scoreFieldNormalized('male, female', 'female, male', 'visible_composition');
  assert.equal(scoredField.correct, true);
  assert.equal(scoredField.predicted, 'female, male');
  assert.equal(scoredField.gold, 'female, male');
});

test('multi-select subset is a miss', () => {
  const scoredField = scoreFieldNormalized('female', 'female, male', 'visible_composition');
  assert.equal(scoredField.correct, false);
});

test('array predictions match comma-separated gold', () => {
  const scoredField = scoreFieldNormalized(['anal', 'vaginal'], 'anal, vaginal', 'activity_action');
  assert.equal(scoredField.correct, true);
  assert.equal(scoredField.predicted, 'anal, vaginal');
});

test('schema N/A is a real class when allowed', () => {
  const scoredField = scoreFieldNormalized('N/A', 'N/A', 'subject_type', {}, { allowNa: true });
  assert.equal(scoredField.correct, true);
  assert.equal(scoredField.predicted, 'n/a');
  assert.equal(scoredField.gold, 'n/a');
});

test('blank gold stays unscored even when N/A is allowed', () => {
  const scoredField = scoreFieldNormalized('n/a', undefined, 'subject_type', {}, { allowNa: true });
  assert.equal(scoredField.gold, null);
  assert.equal(scoredField.correct, null);
});

test('Hamming exact and per-field accuracy share scoreFieldNormalized', () => {
  const fields = {
    visible_composition: scoreFieldNormalized('male, female', 'female, male', 'visible_composition'),
    activity_action: scoreFieldNormalized('posing', 'anal, vaginal', 'activity_action')
  };
  assert.equal(meanFieldMatch(fields), 0.5);
  assert.equal(exactFieldMatch(fields), 0);
  const [composition, activity] = perFieldAccuracy(
    [resultWithFields(fields)],
    ['visible_composition', 'activity_action']
  );
  assert.equal(composition.accuracy, 1);
  assert.equal(activity.accuracy, 0);
});

test('missing boolean prediction is FN not dropped from F1', () => {
  assert.deepEqual(
    fieldConfusion({ domestic_cat: { predicted: null, gold: true, correct: false } }, 'domestic_cat'),
    { tp: 0, fp: 0, fn: 1, tn: 0 }
  );
  assert.deepEqual(
    fieldConfusion({ domestic_cat: { predicted: null, gold: false, correct: false } }, 'domestic_cat'),
    { tp: 0, fp: 0, fn: 0, tn: 1 }
  );
  const results = [
    resultWithFields({ domestic_cat: { predicted: null, gold: true, correct: false } }),
    resultWithFields({ domestic_cat: scored(true, true) })
  ];
  assert.equal(macroF1FromResults(results, ['domestic_cat']), 2 / 3);
});

function reportResult(fields, extras = {}) {
  return {
    model: 'm1',
    prompt_name: 'p1',
    input_data_file: 'case.png',
    input: { case: 'case', kind: 'image' },
    task: { experiment: 'demo', prompt_name: 'p1' },
    quantitative: {
      fields,
      hamming_accuracy: meanFieldMatch(fields),
      exact_match: exactFieldMatch(fields),
      ...extras
    }
  };
}

test('string-only report includes Macro-F1 and P/R/F1 and shows scored vs attempted', () => {
  const results = [
    reportResult({ subject_type: scored('real content', 'real content') }),
    reportResult({ subject_type: scored('other', 'real content') })
  ];
  const report = generateReport(results, { attempted: 5 });
  assert.match(report, /Cases: 2 \/ 5/);
  assert.match(report, /Macro-F1: 0\.33/);
  assert.match(report, /\| Field \| Precision \| Recall \| F1 \| Accuracy \|/);
});

test('majority-class string predictions keep high accuracy and low macro-F1', () => {
  const results = [
    ...Array.from({ length: 20 }, () =>
      resultWithFields({ subject_type: scored('real content', 'real content') })
    ),
    resultWithFields({ subject_type: scored('real content', 'ai / virtual') })
  ];
  const [row] = perFieldClassification(results, ['subject_type']);
  assert.equal(row.accuracy, 20 / 21);
  assert.equal(row.f1, 20 / 41);
});

test('multi-label string F1 gives partial credit while Hamming is a miss', () => {
  const field = scored('vaginal', 'anal, vaginal');
  assert.equal(field.correct, false);
  const [row] = perFieldClassification(
    [resultWithFields({ activity_action: field })],
    ['activity_action']
  );
  assert.equal(row.accuracy, 0);
  assert.equal(row.f1, 0.5);
  assert.equal(macroF1FromResults(
    [resultWithFields({ activity_action: field })],
    ['activity_action']
  ), 0.5);
});

test('N/A is a class in string F1', () => {
  const results = [
    resultWithFields({ toys_props: scored('n/a', 'n/a') }),
    resultWithFields({ toys_props: scored('bondage-gear', 'n/a') })
  ];
  const [row] = perFieldClassification(results, ['toys_props']);
  assert.equal(row.f1, 1 / 3);
  assert.equal(row.accuracy, 0.5);
});

test('blank gold does not enter string F1', () => {
  const results = [
    resultWithFields({ toys_props: { predicted: 'n/a', gold: null, correct: null } }),
    resultWithFields({ toys_props: scored('posing', 'posing') })
  ];
  const [row] = perFieldClassification(results, ['toys_props']);
  assert.equal(row.f1, 1);
  assert.equal(row.accuracy, 1);
});

test('missing string prediction is FN not dropped from F1', () => {
  const results = [
    resultWithFields({ activity_action: { predicted: null, gold: 'posing', correct: false } }),
    resultWithFields({ activity_action: scored('posing', 'posing') })
  ];
  assert.equal(macroF1FromResults(results, ['activity_action']), 2 / 3);
});

test('brierScore is classical Brier against exact match 0 or 1', () => {
  assert.equal(brierScore(0.9, 0), (0.9 - 0) ** 2);
  assert.equal(brierScore(0.9, 1), (0.9 - 1) ** 2);
  assert.equal(brierScore(0.9, 0.8), null);
  assert.equal(brierScore(null, 0), null);
});

test('calibrationMse is squared error against that case Hamming', () => {
  assert.equal(calibrationMse(0.9, 0.8), (0.9 - 0.8) ** 2);
  assert.equal(calibrationMse(0.9, 0.2), (0.9 - 0.2) ** 2);
  assert.equal(calibrationMse(1, 0.75), 0.0625);
  assert.equal(calibrationMse(0.9, 8 / 10), (0.9 - 0.8) ** 2);
  assert.equal(calibrationMse(1, 1.5), null);
  assert.equal(calibrationMse(null, 0.5), null);
});

test('mean of per-case calibration_mse is not square of mean diffs', () => {
  const perCase = [calibrationMse(1, 0.75), calibrationMse(1, 0.25)];
  const meanSquares = perCase.reduce((sum, value) => sum + value, 0) / perCase.length;
  assert.equal(meanSquares, 0.3125);
  assert.notEqual(meanSquares, (1 - 0.5) ** 2);
});

test('report keeps Hamming and shows derived confidence plus residuals', () => {
  const results = [
    reportResult(
      { a: scored(true, true), b: scored(true, false) },
      {
        confidence_exact: 0.6,
        confidence_hamming: 0.8,
        brier_exact: 0.81,
        calibration_mse: 0.16
      }
    )
  ];
  const report = generateReport(results);
  assert.match(report, /Hamming accuracy:/);
  assert.match(report, /Confidence \(exact\):/);
  assert.match(report, /Confidence \(Hamming\):/);
  assert.match(report, /Brier \(exact\):/);
  assert.match(report, /Calibration MSE:/);
  assert.doesNotMatch(report, /Stated confidence:/);
  assert.doesNotMatch(report, /^- Brier:/m);
});

test('headline macro-F1 averages boolean and string field F1', () => {
  const results = [
    resultWithFields({
      domestic_cat: scored(true, true),
      subject_type: scored('real content', 'real content')
    }),
    resultWithFields({
      domestic_cat: scored(false, true),
      subject_type: scored('cartoon-anime', 'real content')
    })
  ];
  assert.equal(macroF1FromResults(results, ['domestic_cat', 'subject_type']), 0.5);
});
