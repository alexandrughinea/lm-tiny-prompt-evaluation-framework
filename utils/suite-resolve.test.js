import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveExperiment, resolveInputDir } from './suite-resolve.js';

function tmpLayout() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'suite-resolve-'));
  const examplesRoot = path.join(root, 'examples');
  const inputsRoot = path.join(root, 'inputs');
  fs.mkdirSync(path.join(examplesRoot, 'cat-detector-suite'), { recursive: true });
  fs.mkdirSync(path.join(inputsRoot, 'image-classification-test', 'data'), { recursive: true });
  fs.mkdirSync(path.join(inputsRoot, 'image-classification-test', 'prompts'), { recursive: true });
  return { root, examplesRoot, inputsRoot };
}

function resolve(env, dirs) {
  return resolveExperiment({
    env,
    projectRoot: dirs.root,
    examplesRoot: dirs.examplesRoot,
    inputsRoot: dirs.inputsRoot,
    defaultExperiment: 'cat-detector-suite'
  });
}

test('INPUT_EXPERIMENT selects a suite under inputs/', () => {
  const dirs = tmpLayout();
  const result = resolve({ INPUT_EXPERIMENT: 'image-classification-test' }, dirs);
  assert.equal(result.name, 'image-classification-test');
  assert.equal(result.root, path.join(dirs.inputsRoot, 'image-classification-test'));
});

test('local inputs/ suite wins over a bundled example with the same name', () => {
  const dirs = tmpLayout();
  fs.mkdirSync(path.join(dirs.inputsRoot, 'cat-detector-suite'));
  const result = resolve({ INPUT_EXPERIMENT: 'cat-detector-suite' }, dirs);
  assert.equal(result.root, path.join(dirs.inputsRoot, 'cat-detector-suite'));
});

test('INPUT_DATA_DIR infers the suite when INPUT_EXPERIMENT is unset', () => {
  const dirs = tmpLayout();
  const result = resolve({
    INPUT_DATA_DIR: 'inputs/image-classification-test/data',
    INPUT_PROMPTS_DIR: 'inputs/image-classification-test/prompts'
  }, dirs);
  assert.equal(result.name, 'image-classification-test');
  assert.equal(result.root, path.join(dirs.inputsRoot, 'image-classification-test'));
});

test('INPUT_ANNOTATIONS_DIR and INPUT_LABELS_DIR infer the suite', () => {
  const dirs = tmpLayout();
  const suite = path.join(dirs.inputsRoot, 'image-classification-test');
  const result = resolve({
    INPUT_ANNOTATIONS_DIR: path.join(suite, 'annotations'),
    INPUT_LABELS_DIR: path.join(suite, 'labels')
  }, dirs);
  assert.equal(result.name, 'image-classification-test');
  assert.equal(result.root, suite);
});

test('resolveInputDir prefers env path over suite fallback', () => {
  const dirs = tmpLayout();
  const fallback = path.join(dirs.inputsRoot, 'image-classification-test', 'labels');
  const override = path.join(dirs.root, 'custom-labels');
  assert.equal(
    resolveInputDir({ INPUT_LABELS_DIR: 'custom-labels' }, 'INPUT_LABELS_DIR', dirs.root, fallback),
    override
  );
  assert.equal(
    resolveInputDir({}, 'INPUT_LABELS_DIR', dirs.root, fallback),
    fallback
  );
});

test('default bundled suite when env has no suite pointer', () => {
  const dirs = tmpLayout();
  const result = resolve({}, dirs);
  assert.equal(result.name, 'cat-detector-suite');
  assert.equal(result.root, path.join(dirs.examplesRoot, 'cat-detector-suite'));
});
