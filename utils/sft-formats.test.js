import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatLlamaRow,
  formatQwenVlRow,
  formatTextRow,
  formatUnslothRow
} from './sft-formats.js';

const sample = {
  id: 'case_ok',
  system: 'You label cases.',
  user: 'Fill every field.\ncase body',
  assistant: { field_a: true, field_b: 'red' },
  imagePaths: ['/abs/data/cat_01.jpg']
};

test('text format string messages no image keys', () => {
  const row = formatTextRow(sample);
  assert.equal(row.id, 'case_ok');
  assert.equal(row.messages[0].role, 'system');
  assert.equal(typeof row.messages[1].content, 'string');
  assert.equal(row.messages[2].role, 'assistant');
  assert.equal(JSON.parse(row.messages[2].content).field_b, 'red');
  assert.equal(row.images, undefined);
  assert.ok(!JSON.stringify(row).includes('cat_01.jpg'));
});

test('unsloth image is absolute path', () => {
  const row = formatUnslothRow(sample);
  const user = row.messages.find(m => m.role === 'user');
  const imagePart = user.content.find(p => p.type === 'image');
  assert.equal(imagePart.image, '/abs/data/cat_01.jpg');
  assert.ok(imagePart.image.endsWith('.jpg'));
  const assistant = row.messages.find(m => m.role === 'assistant');
  assert.equal(assistant.content[0].type, 'text');
});

test('qwen-vl image tag count matches files', () => {
  const row = formatQwenVlRow({
    ...sample,
    imagePaths: ['/a.jpg', '/b.jpg']
  });
  assert.deepEqual(row.images, ['/a.jpg', '/b.jpg']);
  const human = row.conversations.find(c => c.from === 'human').value;
  assert.equal((human.match(/<image>/g) || []).length, 2);
  assert.equal(row.conversations.find(c => c.from === 'gpt').value.includes('field_a'), true);
});

test('qwen-vl single image uses image key', () => {
  const row = formatQwenVlRow(sample);
  assert.equal(row.image, '/abs/data/cat_01.jpg');
  assert.equal(row.images, undefined);
});

test('llama images length equals type image placeholders', () => {
  const row = formatLlamaRow(sample);
  const user = row.messages.find(m => m.role === 'user');
  const placeholders = user.content.filter(p => p.type === 'image');
  assert.equal(row.images.length, placeholders.length);
  assert.equal(row.images[0], '/abs/data/cat_01.jpg');
  assert.equal(typeof row.messages.find(m => m.role === 'assistant').content, 'string');
});

test('vision formats with no images omit image parts', () => {
  const noImg = { ...sample, imagePaths: [] };
  const unsloth = formatUnslothRow(noImg);
  const user = unsloth.messages.find(m => m.role === 'user');
  assert.ok(!user.content.some(p => p.type === 'image'));
  const qwen = formatQwenVlRow(noImg);
  assert.equal(qwen.image, undefined);
  assert.ok(!qwen.conversations[0].value.includes('<image>'));
});
