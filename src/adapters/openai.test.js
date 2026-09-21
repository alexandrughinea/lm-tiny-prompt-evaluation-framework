import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isLmStudioImageUrlError, messagesHaveImageUrls } from './openai.js';

test('isLmStudioImageUrlError matches the LMS body', () => {
  assert.equal(
    isLmStudioImageUrlError({
      response: { data: { error: "'url' field must be a base64 encoded image." } }
    }),
    true
  );
  assert.equal(
    isLmStudioImageUrlError(new Error(`API request failed with status 400: ${JSON.stringify({ error: "'url' field must be a base64 encoded image." })}`)),
    true
  );
});

test('isLmStudioImageUrlError ignores unrelated 400s', () => {
  assert.equal(
    isLmStudioImageUrlError({ response: { data: { error: 'context length exceeded' } } }),
    false
  );
  assert.equal(isLmStudioImageUrlError({ response: { data: { error: 'bad request' } } }), false);
  assert.equal(isLmStudioImageUrlError(null), false);
});

test('messagesHaveImageUrls is true only when a part has image_url', () => {
  assert.equal(messagesHaveImageUrls([{ role: 'user', content: 'plain' }]), false);
  assert.equal(messagesHaveImageUrls([{
    role: 'user',
    content: [
      { type: 'text', text: 'hi' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,abc' } }
    ]
  }]), true);
});
