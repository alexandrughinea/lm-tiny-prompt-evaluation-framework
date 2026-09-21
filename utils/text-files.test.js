import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  TEXT_EXTENSIONS,
  indexTextFiles,
  isTextExtension,
  resolveTextPath,
  textStem
} from './text-files.js';

test('isTextExtension accepts txt and md', () => {
  assert.equal(isTextExtension('case.txt'), true);
  assert.equal(isTextExtension('case.md'), true);
  assert.equal(isTextExtension('CASE.MD'), true);
  assert.equal(isTextExtension('case.png'), false);
  assert.equal(isTextExtension('notes.csv'), false);
});

test('textStem strips txt and md', () => {
  assert.equal(textStem('system_v1.txt'), 'system_v1');
  assert.equal(textStem('case.md'), 'case');
  assert.equal(textStem('pic.png'), null);
});

test('indexTextFiles prefers txt over md for the same stem', () => {
  const indexed = indexTextFiles(['keep.md', 'keep.txt', 'only.md', 'pic.png']);
  assert.equal(indexed.get('keep'), 'keep.txt');
  assert.equal(indexed.get('only'), 'only.md');
  assert.equal(indexed.has('pic'), false);
  assert.deepEqual([...indexed.keys()].sort(), ['keep', 'only']);
});

test('resolveTextPath prefers txt then md', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'text-files-'));
  fs.writeFileSync(path.join(dir, 'both.txt'), 'txt');
  fs.writeFileSync(path.join(dir, 'both.md'), 'md');
  fs.writeFileSync(path.join(dir, 'notes.md'), 'notes');
  assert.equal(resolveTextPath(dir, 'both'), path.join(dir, 'both.txt'));
  assert.equal(resolveTextPath(dir, 'notes'), path.join(dir, 'notes.md'));
  assert.equal(resolveTextPath(dir, 'missing'), null);
  assert.deepEqual(TEXT_EXTENSIONS, ['.txt', '.md']);
});
