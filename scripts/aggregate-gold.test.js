import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cellKey,
  coerceCell,
  detectDelimiter,
  fileNameFromId,
  loadNormalizeMap,
  listAnnotationCsvs,
  majorityOf,
  mergeAnnotations,
  parseArgs,
  parseAnnotationCsv,
  run,
  writeOutputs
} from './aggregate-gold.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aggregate-gold-'));
}

function writeCsv(dir, name, text) {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, text);
  return filePath;
}

test('parseArgs', () => {
  const args = parseArgs([
    '--in', '/tmp/annotations',
    '--out', '/tmp/labels',
    '--id', 'case',
    '--columns', 'color, texture',
    '--majority',
    '--dry-run'
  ]);
  assert.equal(args.idColumn, 'case');
  assert.deepEqual(args.columns, ['color', 'texture']);
  assert.deepEqual(parseArgs(['--columns', 'color;person']).columns, ['color', 'person']);
  assert.equal(args.majority, true);
  assert.equal(args.dryRun, true);
  assert.equal(parseArgs(['--no-majority']).majority, false);
});

test('coerceCell', () => {
  assert.deepEqual(coerceCell(' Yes '), { skip: false, value: true });
  assert.deepEqual(coerceCell('0'), { skip: false, value: false });
  assert.deepEqual(coerceCell('Red'), { skip: false, value: 'red' });
  assert.equal(coerceCell('n/a').skip, true);
  assert.equal(coerceCell('').skip, true);
  assert.equal(coerceCell('#REF!').skip, true);
  assert.equal(coerceCell('#VALUE!').skip, true);
  assert.equal(coerceCell('#N/A').skip, true);
  assert.deepEqual(
    coerceCell(' Crimson ', { column: 'color', aliases: { color: { crimson: 'red' } } }),
    { skip: false, value: 'red' }
  );
  assert.deepEqual(coerceCell('dark  red'), { skip: false, value: 'dark red' });
  assert.equal(coerceCell('maybe', { aliases: { '*': { maybe: null } } }).skip, true);
});

test('normalize.json maps synonyms then majority', () => {
  const dir = tmpDir();
  const mapPath = path.join(dir, 'normalize.json');
  fs.writeFileSync(mapPath, JSON.stringify({
    color: { Crimson: 'red', scarlet: 'red' }
  }));
  const aliases = loadNormalizeMap(mapPath);
  const result = majorityOf(['Crimson', 'RED', 'scarlet', 'blue', 'blue'], 5, {
    column: 'color',
    aliases
  });
  assert.equal(result.value, 'red');
});

test('detectDelimiter prefers semicolon for Numbers exports', () => {
  assert.equal(detectDelimiter('id,color,person\ncat_01,red,yes\n'), ',');
  assert.equal(detectDelimiter('id;color;person\ncat_01;red;yes\n'), ';');
  assert.equal(detectDelimiter('id;note;person\ncat_01;"red, blue";yes\n'), ';');
});

test('parseAnnotationCsv reads semicolon and drops #REF! columns', () => {
  const dir = tmpDir();
  writeCsv(dir, 'numbers.csv', 'id;color;#REF!;person\ncat_01;Red;#REF!;yes\n');
  const table = parseAnnotationCsv(path.join(dir, 'numbers.csv'));
  assert.deepEqual(table.headers, ['id', 'color', 'person']);
  assert.equal(table.rows[0].color, 'Red');
  assert.equal(Object.hasOwn(table.rows[0], '#REF!'), false);
});

test('parseAnnotationCsv keeps header columns when first data row is one quoted field', () => {
  const dir = tmpDir();
  writeCsv(
    dir,
    'quoted.csv',
    'Link,Image ID,Subject Type,Demographic,Body Type\n"file,name.jpg,extra,bits,here"\nplain.jpg,img02,person,demo,slim\n'
  );
  const table = parseAnnotationCsv(path.join(dir, 'quoted.csv'));
  assert.deepEqual(table.headers, ['Link', 'Image ID', 'Subject Type', 'Demographic', 'Body Type']);
  assert.equal(table.rows[1]['Image ID'], 'img02');
});

test('parseAnnotationCsv splits a fully quoted data row into header columns', () => {
  const dir = tmpDir();
  writeCsv(
    dir,
    'quoted.csv',
    'Link,Image ID,Subject Type,Demographic,Body Type\n"pic.jpg,img01,person,demo,slim"\n'
  );
  const table = parseAnnotationCsv(path.join(dir, 'quoted.csv'));
  assert.equal(table.rows[0].Link, 'pic.jpg');
  assert.equal(table.rows[0]['Image ID'], 'img01');
  assert.equal(table.rows[0]['Subject Type'], 'person');
  assert.equal(table.rows[0].Demographic, 'demo');
  assert.equal(table.rows[0]['Body Type'], 'slim');
});

test('writeOutputs writes one gold json per case id with selected columns', () => {
  const dir = tmpDir();
  const outDir = path.join(dir, 'labels');
  const annotationsDir = path.join(dir, 'annotations');
  fs.mkdirSync(annotationsDir);
  writeOutputs({
    outDir,
    annotationsDir,
    labels: [
      { id: 'img01.jpg', record: { 'Subject Type': 'person', Demographic: 'demo' } },
      { id: 'img02', record: {} }
    ],
    flags: [],
    consensusRows: [],
    idColumn: 'Image ID',
    columns: ['Subject Type', 'Demographic'],
    dryRun: false
  });
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(outDir, 'img01.json'), 'utf8')),
    { 'Subject Type': 'person', Demographic: 'demo' }
  );
  assert.equal(fs.existsSync(path.join(outDir, 'img02.json')), false);
});

test('majority 3-2', () => {
  const result = majorityOf(['red', 'Red', 'blue', 'red', 'blue'], 5);
  assert.equal(result.value, 'red');
  assert.equal(result.reason, null);
  assert.equal(result.weak, true);
});

test('weak majority still writes gold with flag', () => {
  const dir = tmpDir();
  writeCsv(dir, 'a.csv', 'id,color\ncat_01,red\n');
  writeCsv(dir, 'b.csv', 'id,color\ncat_01,red\n');
  writeCsv(dir, 'c.csv', 'id,color\ncat_01,red\n');
  writeCsv(dir, 'd.csv', 'id,color\ncat_01,blue\n');
  writeCsv(dir, 'e.csv', 'id,color\ncat_01,blue\n');
  const tables = listAnnotationCsvs(dir).map(parseAnnotationCsv);
  const merged = mergeAnnotations(tables, {
    idColumn: 'id',
    columns: ['color'],
    majority: true
  });
  assert.equal(merged.labels[0].record.color, 'red');
  assert.equal(merged.flags.some(flag => flag.reason === 'weak_majority'), true);
});

test('majority tie is not gold', () => {
  const result = majorityOf(['red', 'blue', 'red', 'blue', 'n/a'], 5);
  assert.equal(result.value, null);
  assert.equal(result.reason, 'tie');
});

test('majority among votes writes gold when others abstain', () => {
  const result = majorityOf(['red', 'red', '', '', ''], 5);
  assert.equal(result.value, 'red');
  assert.equal(result.reason, null);
  assert.equal(result.weak, true);
});

test('fileNameFromId strips image suffix', () => {
  assert.equal(fileNameFromId('cat_01.png'), 'cat_01.json');
  assert.equal(fileNameFromId('case.md'), 'case.json');
  assert.equal(fileNameFromId('image_0'), 'image_0.json');
});

test('fileNameFromId uses basename of urls and paths', () => {
  assert.equal(fileNameFromId('https://cdn.example/cases/cat_01.png'), 'cat_01.json');
  assert.equal(fileNameFromId('folder/case.md'), 'case.json');
});

test('mergeAnnotations canonicalizes image ids so one gold file is written', () => {
  const dir = tmpDir();
  writeCsv(dir, 'a.csv', 'Image ID,color\ncat_01.jpg,red\n');
  writeCsv(dir, 'b.csv', 'Image ID,color\nhttps://cdn.example/cat_01.jpg,red\n');
  writeCsv(dir, 'c.csv', 'Image ID,color\ncat_01,blue\n');
  const tables = listAnnotationCsvs(dir).map(parseAnnotationCsv);
  const merged = mergeAnnotations(tables, {
    idColumn: 'Image ID',
    columns: ['color'],
    majority: true
  });
  assert.equal(merged.labels.length, 1);
  assert.equal(merged.labels[0].id, 'cat_01');
  assert.equal(merged.labels[0].record.color, 'red');
});

test('mergeAnnotations writes snake_case keys from spreadsheet headers', () => {
  const dir = tmpDir();
  writeCsv(
    dir,
    'alice.csv',
    'Link,Subject Type,Activity / Action,Visual Emphasis (focal point)\ncat_01.jpg,real content,oral,bust\n'
  );
  const table = parseAnnotationCsv(path.join(dir, 'alice.csv'));
  const merged = mergeAnnotations([table], {
    idColumn: 'Link',
    columns: ['Subject Type', 'Activity / Action', 'Visual Emphasis (focal point)'],
    majority: false,
    fieldNames: ['subject_type', 'activity_action', 'visual_emphasis']
  });
  assert.deepEqual(merged.labels[0].record, {
    subject_type: 'real content',
    activity_action: 'oral',
    visual_emphasis: 'bust'
  });
  assert.equal(merged.labels[0].id, 'cat_01');
});

test('mergeAnnotations drops spreadsheet id columns that are not report.json fields', () => {
  const dir = tmpDir();
  writeCsv(
    dir,
    'alice.csv',
    'Link,Image ID,Subject Type\ncat_01.jpg,test01_cat,real content\n'
  );
  const table = parseAnnotationCsv(path.join(dir, 'alice.csv'));
  const merged = mergeAnnotations([table], {
    idColumn: 'Link',
    columns: ['Image ID', 'Subject Type'],
    majority: false,
    fieldNames: ['subject_type', 'demographic']
  });
  assert.deepEqual(merged.labels[0].record, { subject_type: 'real content' });
  assert.equal(Object.hasOwn(merged.labels[0].record, 'image_id'), false);
});

test('single csv to gold', () => {
  const dir = tmpDir();
  writeCsv(dir, 'alice.csv', 'id,color,person\ncat_01,Red,yes\ncat_02,blue,NO\n');
  const table = parseAnnotationCsv(path.join(dir, 'alice.csv'));
  const merged = mergeAnnotations([table], {
    idColumn: 'id',
    columns: ['color', 'person'],
    majority: false
  });
  assert.equal(merged.labels.length, 2);
  assert.deepEqual(merged.labels[0].record, { color: 'red', person: true });
  assert.deepEqual(merged.labels[1].record, { color: 'blue', person: false });
  assert.equal(merged.flags.length, 0);
});

test('majority across three annotators', () => {
  const dir = tmpDir();
  writeCsv(dir, 'a.csv', 'id,color,person\ncat_01,red,yes\ncat_02,red,no\n');
  writeCsv(dir, 'b.csv', 'id,color,person\ncat_01,red,yes\ncat_02,green,no\n');
  writeCsv(dir, 'c.csv', 'id,color,person\ncat_01,blue,yes\ncat_02,blue,yes\n');
  const tables = listAnnotationCsvs(dir).map(parseAnnotationCsv);
  const merged = mergeAnnotations(tables, {
    idColumn: 'id',
    columns: ['color', 'person'],
    majority: true
  });
  const byId = Object.fromEntries(merged.labels.map(entry => [entry.id, entry.record]));
  assert.deepEqual(byId.cat_01, { color: 'red', person: true });
  assert.equal(byId.cat_02.person, false);
  assert.equal(Object.hasOwn(byId.cat_02, 'color'), false);
  assert.equal(merged.flags.some(flag => flag.id === 'cat_02' && flag.column === 'color'), true);
});

test('writeOutputs dry-run and write', () => {
  const dir = tmpDir();
  const outDir = path.join(dir, 'labels');
  const annotationsDir = path.join(dir, 'annotations');
  fs.mkdirSync(annotationsDir);
  const labels = [{ id: 'cat_01', record: { color: 'red', person: true } }];
  const flags = [{ id: 'cat_02', column: 'color', votes: 'red:1;blue:1', reason: 'tie' }];
  const consensusRows = [{ id: 'cat_01', color: 'red', person: 'true' }];
  writeOutputs({
    outDir,
    annotationsDir,
    labels,
    flags,
    consensusRows,
    idColumn: 'id',
    columns: ['color', 'person'],
    dryRun: true
  });
  assert.equal(fs.existsSync(path.join(outDir, 'cat_01.json')), false);

  writeOutputs({
    outDir,
    annotationsDir,
    labels,
    flags,
    consensusRows,
    idColumn: 'id',
    columns: ['color', 'person'],
    dryRun: false
  });
  const gold = JSON.parse(fs.readFileSync(path.join(outDir, 'cat_01.json'), 'utf8'));
  assert.deepEqual(gold, { color: 'red', person: true });
  assert.equal(Object.hasOwn(gold, 'stated_confidence'), false);
  const flagsText = fs.readFileSync(path.join(annotationsDir, '_flags.csv'), 'utf8');
  assert.match(flagsText, /cat_02,color,/);
  const consensus = fs.readFileSync(path.join(annotationsDir, '_consensus.csv'), 'utf8');
  assert.match(consensus, /cat_01,red,true/);
});

test('listAnnotationCsvs skips generated files', () => {
  const dir = tmpDir();
  writeCsv(dir, 'alice.csv', 'id,color\ncat_01,red\n');
  writeCsv(dir, '_flags.csv', 'id,column,votes,reason\n');
  writeCsv(dir, '_consensus.csv', 'id,color\n');
  const files = listAnnotationCsvs(dir).map(filePath => path.basename(filePath));
  assert.deepEqual(files, ['alice.csv']);
});

test('run non-interactive majority', async () => {
  const dir = tmpDir();
  const annotationsDir = path.join(dir, 'annotations');
  const outDir = path.join(dir, 'labels');
  fs.mkdirSync(annotationsDir);
  writeCsv(annotationsDir, 'a.csv', 'id,color\nimg.png,Red\n');
  writeCsv(annotationsDir, 'b.csv', 'id,color\nimg.png,red\n');
  writeCsv(annotationsDir, 'c.csv', 'id,color\nimg.png,blue\n');
  await run([
    '--in', annotationsDir,
    '--out', outDir,
    '--id', 'id',
    '--columns', 'color',
    '--majority'
  ]);
  const gold = JSON.parse(fs.readFileSync(path.join(outDir, 'img.json'), 'utf8'));
  assert.equal(gold.color, 'red');
});

test('cellKey', () => {
  assert.equal(cellKey(true), 'true');
  assert.equal(cellKey(false), 'false');
  assert.equal(cellKey('red'), 'red');
});

test('mergeAnnotations keeps schema N/A and skips blank', () => {
  const dir = tmpDir();
  writeCsv(
    dir,
    'alice.csv',
    'id,subject_type,bust_size\ncat_01,N/A,\ncat_02,real content,-\n'
  );
  const table = parseAnnotationCsv(path.join(dir, 'alice.csv'));
  const merged = mergeAnnotations([table], {
    idColumn: 'id',
    columns: ['subject_type', 'bust_size'],
    majority: false,
    fieldNames: ['subject_type', 'bust_size'],
    enums: {
      subject_type: ['real content', 'N/A'],
      bust_size: ['small', 'N/A']
    }
  });
  const byId = Object.fromEntries(merged.labels.map(entry => [entry.id, entry.record]));
  assert.equal(byId.cat_01.subject_type, 'n/a');
  assert.equal(Object.hasOwn(byId.cat_01, 'bust_size'), false);
  assert.equal(byId.cat_02.subject_type, 'real content');
  assert.equal(Object.hasOwn(byId.cat_02, 'bust_size'), false);
});
