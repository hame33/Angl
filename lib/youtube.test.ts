import test from 'node:test';
import assert from 'node:assert/strict';
import { clipWindow, embedUrl, isVideoId, parseVideoUrl, thumbnailFor, watchUrl } from './youtube.ts';

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

test('links coaches paste become a video id', () => {
  for (const link of [
    'https://www.youtube.com/watch?v=bJJy8l6tVAI',
    'youtube.com/watch?v=bJJy8l6tVAI&t=109s',
    'https://m.youtube.com/watch?feature=share&v=bJJy8l6tVAI',
    'https://youtu.be/bJJy8l6tVAI?si=abc',
    'https://www.youtube.com/shorts/bJJy8l6tVAI',
    'https://www.youtube.com/embed/bJJy8l6tVAI?start=3',
    'https://www.youtube.com/live/bJJy8l6tVAI',
    '  bJJy8l6tVAI  ',
  ]) assert.equal(parseVideoUrl(link), 'bJJy8l6tVAI', link);
});

test('a v= parameter on another site is not a YouTube video', () => {
  assert.equal(parseVideoUrl('https://evil.example/watch?v=bJJy8l6tVAI'), null);
  assert.equal(parseVideoUrl('https://youtube.com.evil.example/watch?v=bJJy8l6tVAI'), null);
});

test('nonsense and bad ids are refused', () => {
  assert.equal(parseVideoUrl(''), null);
  assert.equal(parseVideoUrl('not a link'), null);
  assert.equal(parseVideoUrl('https://www.youtube.com/watch?v=<script>'), null);
});
