import test from 'node:test';
import assert from 'node:assert/strict';
import { countTags, libraryQuery, normaliseTag, PAGE_SIZE, parseLibraryRows } from './library.ts';
import { linksFromText, parseLinks } from './profile.ts';

test('the library only ever asks for public clips', () => {
  const q = new URLSearchParams(libraryQuery(null, 1).split('?')[1]);
  assert.equal(q.get('visibility'), 'eq.public');
  assert.equal(q.get('limit'), String(PAGE_SIZE + 1));
  assert.equal(q.get('offset'), '0');
  assert.equal(q.has('tags'), false);
});

test('a tag filter is an array-contains, quoted so it cannot break out', () => {
  assert.equal(new URLSearchParams(libraryQuery('closeouts', 1).split('?')[1]).get('tags'), 'cs.{"closeouts"}');
  assert.equal(new URLSearchParams(libraryQuery('a"},b', 1).split('?')[1]).get('tags'), 'cs.{"a\\"},b"}');
});

test('pages offset by the page size', () => {
  assert.equal(new URLSearchParams(libraryQuery(null, 3).split('?')[1]).get('offset'), String(PAGE_SIZE * 2));
  assert.equal(new URLSearchParams(libraryQuery(null, -4).split('?')[1]).get('offset'), '0');
});

test('tags from the URL are normalised the way the studio stores them', () => {
  assert.equal(normaliseTag(' Close  Outs '), 'close outs');
  assert.equal(normaliseTag(['first', 'second']), 'first');
  assert.equal(normaliseTag(''), null);
  assert.equal(normaliseTag('x'.repeat(41)), null);
});

test('rows that could not play are left out of the library', () => {
  const good = { share_id: 'AbC-123_xyz', title: 'Good', tags: ['a', 3], notes: '', youtube_video_id: 'bJJy8l6tVAI', start_seconds: 109, end_seconds: 143, credit_coach_name: null, published_at: '2026-11-06T00:00:00Z' };
  const rows = parseLibraryRows([good, { ...good, youtube_video_id: null }, { ...good, end_seconds: 100 }, { ...good, share_id: 'bad' }]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0]?.tags, ['a']);
});

test('tags are counted, most used first, ties alphabetical', () => {
  assert.deepEqual(countTags([['defence', 'closeouts'], ['defence'], ['press', 7 as unknown as string]]),
    [{ tag: 'defence', count: 2 }, { tag: 'closeouts', count: 1 }, { tag: 'press', count: 1 }]);
});

test('profile links are https only, read from "Label | URL" lines', () => {
  assert.deepEqual(linksFromText('Instagram | https://instagram.com/x\nbad line\nEvil | javascript:alert(1)\nSite|https://example.com'),
    [{ label: 'Instagram', url: 'https://instagram.com/x' }, { label: 'Site', url: 'https://example.com' }]);
  assert.deepEqual(parseLinks([{ label: 'A', url: 'http://insecure' }, { label: 'B', url: 'https://ok' }, 'junk']), [{ label: 'B', url: 'https://ok' }]);
});
