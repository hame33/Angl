import test from 'node:test';
import assert from 'node:assert/strict';
import { isShareId, parseSharedClip } from './shared-clip.ts';

const good = {
  shareId: 'AbC-123_xyz',
  visibility: 'public',
  title: 'Closeout to the nail',
  tags: ['defence', 'closeouts'],
  notes: 'High hands.',
  coachingPoints: ['Chop your feet'],
  video: { provider: 'youtube', videoId: 'abcdefghijk' },
  startSeconds: 61.5,
  endSeconds: 75,
  credit: { coachName: 'Coach X', url: 'https://www.youtube.com/@coachx', sourceTitle: 'Closeout clinic',
    channelName: 'Uploader', channelUrl: 'https://www.youtube.com/@uploader' },
  thumbnailUrl: 'https://i.ytimg.com/vi/abcdefghijk/maxresdefault.jpg',
  publishedAt: '2026-11-06T00:00:00Z',
  updatedAt: '2026-11-06T00:00:00Z',
};

test('a well-formed payload parses', () => {
  const c = parseSharedClip(good);
  assert.ok(c);
  assert.equal(c.videoId, 'abcdefghijk');
  assert.equal(c.startSeconds, 61.5);
  assert.deepEqual(c.tags, ['defence', 'closeouts']);
});

test('null (private or unknown) is no clip', () => {
  assert.equal(parseSharedClip(null), null);
});

test('a private clip is refused even if one were returned', () => {
  assert.equal(parseSharedClip({ ...good, visibility: 'private' }), null);
});

test('an unplayable clip is refused rather than rendered broken', () => {
  assert.equal(parseSharedClip({ ...good, video: { videoId: null } }), null);
  assert.equal(parseSharedClip({ ...good, endSeconds: 61 }), null);
  assert.equal(parseSharedClip({ ...good, startSeconds: 'soon' }), null);
});

test('non-https credit and thumbnail URLs are dropped, not rendered', () => {
  const c = parseSharedClip({ ...good, credit: { ...good.credit, url: 'javascript:alert(1)' }, thumbnailUrl: 'http://x' });
  assert.ok(c);
  assert.equal(c.credit.url, null);
  assert.equal(c.thumbnailUrl, null);
});

test('the uploading channel is credited separately from the coach', () => {
  const c = parseSharedClip(good);
  assert.ok(c);
  assert.equal(c.credit.coachName, 'Coach X');
  assert.equal(c.credit.channelName, 'Uploader');
  assert.equal(c.credit.channelUrl, 'https://www.youtube.com/@uploader');
});

test('an older payload with no channel still parses', () => {
  const c = parseSharedClip({ ...good, credit: { coachName: 'Coach X', url: null, sourceTitle: null } });
  assert.ok(c);
  assert.equal(c.credit.channelName, null);
  assert.equal(c.credit.channelUrl, null);
});

test('junk in the arrays is filtered out', () => {
  const c = parseSharedClip({ ...good, tags: ['ok', 3, null], coachingPoints: 'nope' });
  assert.ok(c);
  assert.deepEqual(c.tags, ['ok']);
  assert.deepEqual(c.coachingPoints, []);
});

test('share ids are exactly what the database generates', () => {
  assert.equal(isShareId('AbC-123_xyz'), true);
  assert.equal(isShareId('short'), false);
  assert.equal(isShareId('AbC-123_xyz/../x'), false);
});
