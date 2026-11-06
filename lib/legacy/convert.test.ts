import test from 'node:test';
import assert from 'node:assert/strict';
import { convertLibrary, groupClips } from './convert.ts';
import { legacyClipId, uuidV5 } from './ids.ts';
import { libraryFromExport } from './migrate.ts';
import type { LegacyLibrary } from './types.ts';

const lib = (over: Partial<LegacyLibrary> = {}): LegacyLibrary => ({
  teams: [{ id: 't1', name: 'U16 Boys', sport: 'basketball' }],
  games: [{ id: 'g1', teamId: 't1', title: 'Round 7', videoId: 'bJJy8l6tVAI' }],
  playlists: [{ id: 'p1', gameId: 'g1', name: 'Defence', emoji: '🛡️' }],
  clips: [{ id: 'c1', label: '2 on 1', gameId: 'g1', playlistId: 'p1', start: 111, end: 141, bufBefore: 2, bufAfter: 2, effStart: 109, effEnd: 143 }],
  ...over,
});

test('a clip keeps the range classic Angl played, and its marks', () => {
  const [c] = convertLibrary(lib()).clips;
  assert.ok(c);
  assert.equal(c.startSeconds, 109);
  assert.equal(c.endSeconds, 143);
  assert.equal(c.markedStartSeconds, 111);
  assert.equal(c.markedEndSeconds, 141);
});

test('the film comes from the game when the clip has none, and team/film/category travel with it', () => {
  const [c] = convertLibrary(lib()).clips;
  assert.ok(c);
  assert.equal(c.videoId, 'bJJy8l6tVAI');
  assert.equal(c.category, 'Defence');
  assert.deepEqual(
    { team: c.legacy.teamName, film: c.legacy.gameTitle, sport: c.legacy.sport, emoji: c.legacy.categoryEmoji, index: c.legacy.index },
    { team: 'U16 Boys', film: 'Round 7', sport: 'basketball', emoji: '🛡️', index: 0 },
  );
});

test('a clip saved before effStart/effEnd is worked out from marks and buffers', () => {
  const [c] = convertLibrary(lib({ clips: [{ id: 'c1', label: 'Old', gameId: 'g1', playlistId: 'p1', start: 1, end: 5, bufBefore: 2, bufAfter: 3 }] })).clips;
  assert.ok(c);
  assert.equal(c.startSeconds, 0);   // never below zero, like classic Angl
  assert.equal(c.endSeconds, 8);
});

test('broken clips are skipped with a reason, never stored half-formed', () => {
  const r = convertLibrary(lib({
    clips: [
      { id: 'a', label: 'No times', gameId: 'g1' },
      { id: 'b', label: 'Backwards', gameId: 'g1', effStart: 20, effEnd: 10 },
      { label: 'No id', gameId: 'g1', effStart: 1, effEnd: 2 },
      { id: 'd', label: 'Fine', gameId: 'g1', effStart: 1, effEnd: 2 },
      { id: 'd', label: 'Duplicate id', gameId: 'g1', effStart: 3, effEnd: 4 },
    ],
  }));
  assert.deepEqual(r.clips.map(c => c.title), ['Fine']);
  assert.deepEqual(r.skipped.map(s => s.label), ['No times', 'Backwards', 'No id', 'Duplicate id']);
});

test('an unlabelled clip gets the name classic Angl would have shown', () => {
  const [c] = convertLibrary(lib({ clips: [{ id: 'c1', label: '  ', gameId: 'g1', effStart: 1, effEnd: 2 }] })).clips;
  assert.equal(c?.title, 'Clip 1');
});

test('a malformed video id is dropped, so it can never reach a URL', () => {
  const [c] = convertLibrary(lib({ games: [{ id: 'g1', teamId: 't1', title: 'X', videoId: '"><script>' }] })).clips;
  assert.equal(c?.videoId, null);
});

test('grouping counts clips by team, film and category, in library order', () => {
  const file = {
    clips: [
      { id: 'c1', label: 'A', videoId: 'vidAAAAAAAA', playlistId: 'p1', effStart: 1, effEnd: 2 },
      { id: 'c2', label: 'B', videoId: 'vidAAAAAAAA', playlistId: 'p2', effStart: 1, effEnd: 2 },
      { id: 'c3', label: 'C', videoId: 'vidBBBBBBBB', playlistId: 'p1', effStart: 1, effEnd: 2 },
    ],
    playlists: [{ id: 'p1', name: 'Defence', emoji: '🛡️' }, { id: 'p2', name: 'Offence', emoji: '⚡' }],
  };
  const groups = groupClips(convertLibrary(libraryFromExport(file)!).clips)
    .map(t => ({ ...t, films: t.films.map(({ key, ...f }) => { assert.ok(key); return f; }) }));
  assert.deepEqual(groups, [{
    team: 'My team', count: 3, films: [
      { film: 'Game 1', count: 2, categories: [{ category: 'Defence', count: 1 }, { category: 'Offence', count: 1 }] },
      { film: 'Game 2', count: 1, categories: [{ category: 'Defence', count: 1 }] },
    ],
  }]);
});

test('uuidV5 matches the RFC test vector', async () => {
  // www.example.com in the DNS namespace
  assert.equal(await uuidV5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8'), '2ed6657d-e927-568b-95e1-2665a8aea6a2');
});

test('the same clip always gets the same id; another owner, or another film, does not', async () => {
  const c = { legacyId: 'c1', videoId: 'bJJy8l6tVAI', startSeconds: 109, endSeconds: 143 };
  const a = await legacyClipId('owner-a', c);
  assert.equal(await legacyClipId('owner-a', { ...c }), a);
  assert.notEqual(await legacyClipId('owner-b', c), a);
  assert.notEqual(await legacyClipId('owner-a', { ...c, videoId: 'otherVideo1' }), a);
});

test('two films with the same title stay apart', () => {
  const groups = groupClips(convertLibrary(lib({
    games: [{ id: 'g1', teamId: 't1', title: 'Untitled film', videoId: 'vidAAAAAAAA' }, { id: 'g2', teamId: 't1', title: 'Untitled film', videoId: 'vidBBBBBBBB' }],
    clips: [{ id: 'a', gameId: 'g1', effStart: 1, effEnd: 2 }, { id: 'b', gameId: 'g2', effStart: 1, effEnd: 2 }],
  })).clips);
  assert.equal(groups[0]?.films.length, 2);
});
