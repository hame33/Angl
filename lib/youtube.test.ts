import test from 'node:test';
import assert from 'node:assert/strict';
import { clipWindow, embedUrl, isVideoId, thumbnailFor, watchUrl } from './youtube.ts';

test('a clip window rounds outward, so nothing marked is cut off', () => {
  assert.deepEqual(clipWindow(12.5, 20.5), { start: 12, end: 21 });
  assert.deepEqual(clipWindow(10, 20), { start: 10, end: 20 });
});

test('a sub-second clip still plays for at least a second', () => {
  assert.deepEqual(clipWindow(10.2, 10.4), { start: 10, end: 11 });
});

test('a negative start is held at zero', () => {
  assert.deepEqual(clipWindow(-3, 5), { start: 0, end: 5 });
});

test('the embed is no-cookie, inline, and carries the clip window', () => {
  const u = new URL(embedUrl('abcdefghijk', 61.5, 75.2, true));
  assert.equal(u.host, 'www.youtube-nocookie.com');
  assert.equal(u.pathname, '/embed/abcdefghijk');
  assert.equal(u.searchParams.get('start'), '61');
  assert.equal(u.searchParams.get('end'), '76');
  assert.equal(u.searchParams.get('playsinline'), '1');
  assert.equal(u.searchParams.get('autoplay'), '1');
});

test('autoplay is only set when asked for', () => {
  assert.equal(new URL(embedUrl('abcdefghijk', 1, 2, false)).searchParams.has('autoplay'), false);
});

test('the source link opens the full video at the clip', () => {
  assert.equal(watchUrl('abcdefghijk', 61.9), 'https://www.youtube.com/watch?v=abcdefghijk&t=61s');
  assert.equal(watchUrl('abcdefghijk'), 'https://www.youtube.com/watch?v=abcdefghijk');
});

test('video ids are checked, so nothing odd reaches a URL', () => {
  assert.equal(isVideoId('abcdefghijk'), true);
  assert.equal(isVideoId('abc'), false);
  assert.equal(isVideoId('abcdefghijk"><script>'), false);
  assert.equal(isVideoId(null), false);
});

test('a stored maxres thumbnail keeps its size; no thumbnail falls back to hq', () => {
  assert.deepEqual(thumbnailFor('abcdefghijk', 'https://i.ytimg.com/vi/abcdefghijk/maxresdefault.jpg'),
    { url: 'https://i.ytimg.com/vi/abcdefghijk/maxresdefault.jpg', width: 1280, height: 720 });
  assert.deepEqual(thumbnailFor('abcdefghijk', null),
    { url: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg', width: 480, height: 360 });
});

test('a thumbnail from anywhere but YouTube is ignored', () => {
  assert.equal(thumbnailFor('abcdefghijk', 'https://evil.example/x.jpg').url,
    'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg');
});
