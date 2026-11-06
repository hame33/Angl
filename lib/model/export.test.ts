import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyToV5 } from '../legacy/to-v5.ts';
import { libraryFromExport } from '../legacy/migrate.ts';
import { buildExport, readExport } from './export.ts';

const v4 = {
  version: 4,
  teams: [{ id: 't1', name: 'U16 Boys', sport: 'basketball', createdAt: 1700000000000 }],
  games: [{ id: 'g1', teamId: 't1', title: 'Round 7', videoId: 'bJJy8l6tVAI', createdAt: 1700000000000 }],
  playlists: [{ id: 'p1', gameId: 'g1', name: 'Defence', emoji: '🛡️' }, { id: 'p2', gameId: 'g1', name: 'Empty', emoji: '📌' }],
  clips: [
    { id: 'c1', label: '2 on 1', videoId: 'bJJy8l6tVAI', gameId: 'g1', playlistId: 'p1', start: 111, end: 141, bufBefore: 2, bufAfter: 2, effStart: 109, effEnd: 143 },
    { id: 'c2', label: 'Broken', gameId: 'g1', playlistId: 'p1', effStart: 9, effEnd: 3 },
  ],
  durationModel: { version: 1 },
  dictationLog: [{ at: 1, heard: 'x' }],
};

test('a version 4 export reads into teams, films and clips, with its broken clip skipped', async () => {
  const r = await readExport(v4);
  assert.ok(r.ok);
  assert.equal(r.version, 4);
  assert.deepEqual([r.library.teams.length, r.library.films.length, r.library.clips.length], [1, 1, 1]);
  assert.deepEqual(r.library.films[0]?.categories.map(c => c.name), ['Defence', 'Empty'], 'empty categories survive');
  assert.deepEqual(r.skipped.map(s => s.label), ['Broken']);
  assert.deepEqual(r.extras.dictationLog, [{ at: 1, heard: 'x' }]);
});

test('export then import is lossless (version 5 round trip)', async () => {
  const r = await readExport(v4);
  assert.ok(r.ok);
  const file = JSON.parse(JSON.stringify(buildExport(r.library, r.extras, '2026-11-06T00:00:00.000Z')));
  assert.equal(file.format, 'angl.library');
  assert.equal(file.version, 5);
  const back = await readExport(file);
  assert.ok(back.ok);
  assert.equal(back.version, 5);
  assert.deepEqual(back.library, r.library);
  assert.deepEqual(back.extras, r.extras);
});

test('a classic export and the same library read from this browser give the same ids', async () => {
  const fromFile = await readExport(v4);
  const fromStorage = await legacyToV5(libraryFromExport(v4)!);
  assert.ok(fromFile.ok);
  assert.deepEqual(fromFile.library.clips.map(c => c.id), fromStorage.clips.map(c => c.id));
  assert.deepEqual(fromFile.library.films.map(f => f.id), fromStorage.films.map(f => f.id));
});

test('importing the same version 1 file twice gives the same ids', async () => {
  const v1 = { clips: [{ id: 'c1', label: 'A', videoId: 'bJJy8l6tVAI', playlistId: 'p1', effStart: 1, effEnd: 2 }], playlists: [{ id: 'p1', name: 'Defence', emoji: '🛡️' }] };
  const a = await readExport(structuredClone(v1)), b = await readExport(structuredClone(v1));
  assert.ok(a.ok && b.ok);
  // Ids are what stop a re-import duplicating; a migrated film's creation time is "now" and may differ
  const ids = (l: typeof a.library) => [l.teams, l.films, l.clips].map(xs => xs.map(x => x.id));
  assert.deepEqual(ids(a.library), ids(b.library));
  assert.equal(a.library.films.length, 1);
});

test('a damaged version 5 file is refused with the field that’s wrong', async () => {
  const r = await readExport(v4);
  assert.ok(r.ok);
  const file = JSON.parse(JSON.stringify(buildExport(r.library, r.extras)));
  file.clips[0].credit.url = 'javascript:alert(1)';
  const back = await readExport(file);
  assert.equal(back.ok, false);
  assert.match(back.ok ? '' : back.message, /clips\.0\.credit\.url/);
});

test('a clip that ends before it starts is refused in a version 5 file', async () => {
  const r = await readExport(v4);
  assert.ok(r.ok);
  const file = JSON.parse(JSON.stringify(buildExport(r.library, r.extras)));
  file.clips[0].endSeconds = 1;
  assert.equal((await readExport(file)).ok, false);
});

test('something that isn’t an Angl export is refused', async () => {
  assert.equal((await readExport({ hello: 1 })).ok, false);
  assert.equal((await readExport(null)).ok, false);
});
