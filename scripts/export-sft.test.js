import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  goldAssistant,
  listCases,
  loadPromptPair,
  parseArgs,
  runExport
} from './export-sft.js';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSjAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

function tmpSuite() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'export-sft-'));
  const prompts = path.join(root, 'prompts');
  const data = path.join(root, 'data');
  const labels = path.join(root, 'labels');
  fs.mkdirSync(prompts);
  fs.mkdirSync(data);
  fs.mkdirSync(labels);
  fs.writeFileSync(path.join(prompts, 'system_v1.txt'), 'You label cases.\n');
  fs.writeFileSync(path.join(prompts, 'user_v1.txt'), 'Fill every field.\n');
  fs.writeFileSync(path.join(data, 'case_ok.txt'), 'body text');
  fs.writeFileSync(path.join(labels, 'case_ok.json'), JSON.stringify({
    bucket: 'ignore',
    stated_confidence: 0.9,
    field_a: true,
    field_b: 'red'
  }));
  fs.writeFileSync(path.join(data, 'pic.png'), PNG_1X1);
  fs.writeFileSync(path.join(labels, 'pic.json'), JSON.stringify({ field_a: false, field_b: 'blue' }));
  fs.writeFileSync(path.join(data, 'orphan.txt'), 'no gold');
  return { root, prompts, data, labels };
}

function dirs(suite) {
  return {
    dataDir: suite.data,
    labelsDir: suite.labels,
    promptsDir: suite.prompts,
    prompt: 'v1'
  };
}

await test('parseArgs', () => {
  const args = parseArgs(['--format', 'unsloth', '--prompt', 'v1', '--out', '/tmp/a.jsonl', '--drop-images']);
  assert.equal(args.format, 'unsloth');
  assert.equal(args.prompt, 'v1');
  assert.equal(args.dropImages, true);
});

await test('goldAssistant strips bucket and stated_confidence', () => {
  const gold = goldAssistant({
    bucket: 'cat',
    stated_confidence: 0.4,
    field_a: true
  });
  assert.equal(gold.bucket, undefined);
  assert.equal(gold.stated_confidence, undefined);
  assert.equal(gold.field_a, true);
});

await test('text format writes assistant JSON without image keys', async () => {
  const suite = tmpSuite();
  const out = path.join(suite.root, 'train.jsonl');
  const summary = await runExport({
    ...dirs(suite),
    format: 'text',
    out,
    dropImages: true
  });
  assert.equal(summary.n, 1);
  assert.ok(summary.skipped.noGold.includes('orphan'));
  const row = JSON.parse(fs.readFileSync(out, 'utf8').trim());
  assert.equal(row.messages[2].role, 'assistant');
  assert.deepEqual(JSON.parse(row.messages[2].content), { field_a: true, field_b: 'red' });
  assert.ok(!fs.readFileSync(out, 'utf8').includes('.png'));
});

await test('text format throws on image cases', async () => {
  const suite = tmpSuite();
  await assert.rejects(
    () => runExport({
      ...dirs(suite),
      format: 'text',
      out: path.join(suite.root, 'x.jsonl')
    }),
    /has images/
  );
});

await test('unsloth image path is absolute and ends with .png', async () => {
  const suite = tmpSuite();
  const out = path.join(suite.root, 'vl.jsonl');
  const holdout = path.join(suite.root, 'holdout.txt');
  fs.writeFileSync(holdout, 'case_ok\n');
  const summary = await runExport({
    ...dirs(suite),
    format: 'unsloth',
    out,
    holdout
  });
  assert.ok(summary.skipped.holdout.includes('case_ok'));
  const lines = fs.readFileSync(out, 'utf8').trim().split('\n').map(JSON.parse);
  const pic = lines.find(row => row.id === 'pic');
  const user = pic.messages.find(m => m.role === 'user');
  const imagePart = user.content.find(p => p.type === 'image');
  assert.ok(path.isAbsolute(imagePart.image));
  assert.ok(imagePart.image.endsWith('.png'));
});

await test('qwen-vl tag count and llama placeholders', async () => {
  const suite = tmpSuite();
  const qwenOut = path.join(suite.root, 'qwen.jsonl');
  await runExport({
    ...dirs(suite),
    format: 'qwen-vl',
    out: qwenOut,
    holdout: new Set(['case_ok', 'orphan'])
  });
  const qwen = JSON.parse(fs.readFileSync(qwenOut, 'utf8').trim());
  const tags = (qwen.conversations[0].value.match(/<image>/g) || []).length;
  assert.equal(tags, 1);
  assert.equal(qwen.image.endsWith('pic.png'), true);

  const llamaOut = path.join(suite.root, 'llama.jsonl');
  await runExport({
    ...dirs(suite),
    format: 'llama',
    out: llamaOut,
    holdout: new Set(['case_ok', 'orphan'])
  });
  const llama = JSON.parse(fs.readFileSync(llamaOut, 'utf8').trim());
  const placeholders = llama.messages.find(m => m.role === 'user').content.filter(p => p.type === 'image');
  assert.equal(llama.images.length, placeholders.length);
});

await test('loadPromptPair accepts md when txt is missing', () => {
  const suite = tmpSuite();
  fs.unlinkSync(path.join(suite.prompts, 'system_v1.txt'));
  fs.unlinkSync(path.join(suite.prompts, 'user_v1.txt'));
  fs.writeFileSync(path.join(suite.prompts, 'system_v1.md'), 'System md.\n');
  fs.writeFileSync(path.join(suite.prompts, 'user_v1.md'), 'User md.\n');
  const pair = loadPromptPair(suite.prompts, 'v1');
  assert.equal(pair.system, 'System md.');
  assert.equal(pair.user, 'User md.');
});

await test('listCases loads md cases and prefers txt over md', async () => {
  const suite = tmpSuite();
  fs.writeFileSync(path.join(suite.data, 'markdown_only.md'), 'from md');
  fs.writeFileSync(path.join(suite.data, 'case_ok.md'), 'should not win');
  const cases = await listCases(suite.data);
  const byId = Object.fromEntries(cases.map(entry => [entry.id, entry]));
  assert.equal(byId.markdown_only.text, 'from md');
  assert.equal(byId.case_ok.text, 'body text');
});
