import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  alignGoldKeys,
  canonicalFieldName,
  caseIdFromValue,
  coerceCell,
  enumsFromSchema,
  fieldAllowsNa,
  fieldNamesFromSuite,
  goldFileName,
  humanizeFieldName,
  isGoldField,
  normalizeScalar,
  readGoldFile,
  rewriteRecordKeys,
  slugFieldName
} from './label-normalize.js';
import { scoreFieldNormalized } from './report-utils.js';

test('slugFieldName turns spreadsheet headers into snake_case', () => {
  assert.equal(slugFieldName('Subject Type'), 'subject_type');
  assert.equal(slugFieldName('Activity / Action'), 'activity_action');
  assert.equal(slugFieldName('Toys / Props'), 'toys_props');
  assert.equal(slugFieldName('Visual Emphasis (focal point)'), 'visual_emphasis_focal_point');
  assert.equal(slugFieldName('subject_type'), 'subject_type');
});

test('canonicalFieldName maps a display header onto a known schema field', () => {
  const fields = ['subject_type', 'visual_emphasis', 'activity_action'];
  assert.equal(canonicalFieldName('Subject Type', fields), 'subject_type');
  assert.equal(canonicalFieldName('Activity / Action', fields), 'activity_action');
  assert.equal(
    canonicalFieldName('Visual Emphasis (focal point)', fields),
    'visual_emphasis'
  );
  assert.equal(canonicalFieldName('subject_type', fields), 'subject_type');
});

test('canonicalFieldName without known fields still slugifies', () => {
  assert.equal(canonicalFieldName('Subject Type'), 'subject_type');
  assert.equal(canonicalFieldName('Activity / Action'), 'activity_action');
});

test('alignGoldKeys rewrites title-case gold onto report.json fields', () => {
  const aligned = alignGoldKeys({
    'Image ID': 'skip-me',
    'Subject Type': 'real content',
    'Activity / Action': 'oral',
    'Visual Emphasis (focal point)': 'bust',
    bucket: 'keep'
  }, [
    'subject_type',
    'activity_action',
    'visual_emphasis'
  ]);
  assert.equal(aligned.subject_type, 'real content');
  assert.equal(aligned.activity_action, 'oral');
  assert.equal(aligned.visual_emphasis, 'bust');
  assert.equal(aligned.bucket, 'keep');
  assert.equal(Object.hasOwn(aligned, 'Subject Type'), false);
  assert.equal(Object.hasOwn(aligned, 'image_id'), false);
  assert.equal(Object.hasOwn(aligned, 'Image ID'), false);
});

test('aligned gold scores as a match against snake_case predictions', () => {
  const aligned = alignGoldKeys(
    { 'Subject Type': 'real content' },
    ['subject_type']
  );
  assert.deepEqual(
    scoreFieldNormalized('real content', aligned.subject_type, 'subject_type'),
    { predicted: 'real content', gold: 'real content', correct: true }
  );
});

test('missing gold is unscored rather than a miss', () => {
  const scored = scoreFieldNormalized('blonde', undefined, 'hair_color');
  assert.equal(scored.gold, null);
  assert.equal(scored.correct, null);
});

test('isGoldField keeps schema fields and drops spreadsheet ids', () => {
  const fields = ['subject_type'];
  assert.equal(isGoldField('subject_type', fields), true);
  assert.equal(isGoldField('bucket', fields), true);
  assert.equal(isGoldField('image_id', fields), false);
  assert.equal(isGoldField('image_id', []), true);
});

test('rewriteRecordKeys maps headers and keeps unknown keys', () => {
  const rewritten = rewriteRecordKeys({
    'Subject Type': 'real content',
    'Image ID': 'meta'
  }, ['subject_type']);
  assert.equal(rewritten.subject_type, 'real content');
  assert.equal(rewritten.image_id, 'meta');
});

test('humanizeFieldName is the display inverse of slugFieldName', () => {
  assert.equal(humanizeFieldName('subject_type'), 'Subject Type');
  assert.equal(slugFieldName(humanizeFieldName('activity_action')), 'activity_action');
});

test('caseIdFromValue strips data suffixes the same way for every command', () => {
  assert.equal(caseIdFromValue('cat_01.png'), 'cat_01');
  assert.equal(caseIdFromValue('case.md'), 'case');
  assert.equal(caseIdFromValue('row.csv'), 'row');
  assert.equal(caseIdFromValue('case_ok.json'), 'case_ok');
  assert.equal(caseIdFromValue('https://cdn.example/cases/cat_01.png'), 'cat_01');
  assert.equal(goldFileName('folder/case.md'), 'case.json');
});

test('fieldNamesFromSuite prefers report.json then schema', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'suite-fields-'));
  fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify({
    fields: ['subject_type', 'demographic']
  }));
  assert.deepEqual(fieldNamesFromSuite({ root }), ['subject_type', 'demographic']);
});

test('readGoldFile stems the id, aligns keys, and drops non-fields', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gold-read-'));
  fs.writeFileSync(path.join(dir, 'cat_01.json'), JSON.stringify({
    'Subject Type': 'real content',
    'Image ID': 'meta'
  }));
  const { label, error } = readGoldFile(dir, 'cat_01.png', ['subject_type']);
  assert.equal(error, null);
  assert.equal(label.subject_type, 'real content');
  assert.equal(Object.hasOwn(label, 'image_id'), false);
});

test('coerceCell keeps N/A when the field enum includes it', () => {
  const enums = { subject_type: ['real content', 'N/A'] };
  assert.deepEqual(
    coerceCell('N/A', { column: 'subject_type', enums }),
    { skip: false, value: 'n/a' }
  );
  assert.deepEqual(
    coerceCell('n/a', { allowNa: true }),
    { skip: false, value: 'n/a' }
  );
});

test('coerceCell still skips n/a when the enum has no N/A', () => {
  assert.equal(coerceCell('n/a').skip, true);
  assert.equal(coerceCell('n/a', { column: 'color', enums: { color: ['red', 'blue'] } }).skip, true);
  assert.equal(coerceCell('').skip, true);
  assert.equal(coerceCell('-').skip, true);
  assert.equal(coerceCell('none').skip, true);
});

test('normalizeScalar sorts unique multi-select tokens and arrays', () => {
  assert.equal(normalizeScalar('male, female', 'visible_composition'), 'female, male');
  assert.equal(normalizeScalar(['anal', 'vaginal'], 'activity_action'), 'anal, vaginal');
  assert.equal(normalizeScalar('N/A', 'subject_type', {}, { allowNa: true }), 'n/a');
  assert.equal(normalizeScalar('N/A', 'subject_type'), null);
});

test('fieldAllowsNa reads schema enums', () => {
  const enums = enumsFromSchema({
    properties: {
      subject_type: { enum: ['real content', 'N/A'] },
      color: { enum: ['red'] },
      flag: { type: 'boolean' }
    }
  });
  assert.equal(fieldAllowsNa('subject_type', enums), true);
  assert.equal(fieldAllowsNa('color', enums), false);
  assert.equal(fieldAllowsNa('flag', enums), false);
});
