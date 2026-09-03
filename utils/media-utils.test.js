import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  rewriteMessageImageUrls,
  toChatImageUrl,
  toDataUrl,
  toRawBase64Url
} from './media-utils.js';

test('JPEG and PNG keep their data URI mime', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
  assert.equal(toChatImageUrl(jpeg, 'image/jpeg'), toDataUrl(jpeg, 'image/jpeg'));
  assert.match(toChatImageUrl(jpeg, 'image/jpeg'), /^data:image\/jpeg;base64,/);

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  assert.equal(toChatImageUrl(png, 'image/png'), toDataUrl(png, 'image/png'));
  assert.match(toChatImageUrl(png, 'image/png'), /^data:image\/png;base64,/);
});

test('WebP and GIF declare png in the data URI with original bytes', () => {
  const webp = Buffer.from('webp-bytes');
  assert.equal(toChatImageUrl(webp, 'image/webp'), `data:image/png;base64,${webp.toString('base64')}`);

  const gif = Buffer.from('gif-bytes');
  assert.equal(toChatImageUrl(gif, 'image/gif'), `data:image/png;base64,${gif.toString('base64')}`);
});

test('toRawBase64Url strips a data URI prefix and leaves raw strings alone', () => {
  const buf = Buffer.from('hello');
  const dataUrl = toDataUrl(buf, 'image/jpeg');
  assert.equal(toRawBase64Url(dataUrl), buf.toString('base64'));
  assert.equal(toRawBase64Url(buf.toString('base64')), buf.toString('base64'));
});

test('rewriteMessageImageUrls maps image_url.url without mutating the original', () => {
  const messages = [{
    role: 'user',
    content: [
      { type: 'text', text: 'hi' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,abc' } }
    ]
  }];
  const rewritten = rewriteMessageImageUrls(messages, toRawBase64Url);
  assert.equal(rewritten[0].content[1].image_url.url, 'abc');
  assert.equal(rewritten[0].content[0].text, 'hi');
  assert.equal(messages[0].content[1].image_url.url, 'data:image/jpeg;base64,abc');
});
