/*
 * The TypeScript port of classic Angl's migrations must convert a library
 * exactly as index.html does. These tests run the classic code itself (lifted
 * out of index.html by the existing sandbox) and the port on the same
 * fixtures, then compare. Ids are random on both sides, so the comparison is
 * by structure: which game each clip landed in, under which category, owned by
 * which team.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error -- classic Angl's test sandbox is plain JS
import { loadApp } from '../../tests/load-app.mjs';
import { libraryFromExport, migrateToGames, migrateToTeams } from './migrate.ts';
import type { LegacyLibrary } from './types.ts';

type Lib = { clips: any[]; playlists: any[]; games: any[]; teams: any[] };
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function shape(lib: Lib) {
  const g = (id: string) => lib.games.findIndex(x => x.id === id);
  const t = (id: string) => lib.teams.findIndex(x => x.id === id);
  return {
    teams: lib.teams.map(x => ({ name: x.name, sport: x.sport })),
    games: lib.games.map(x => ({ title: x.title, videoId: x.videoId ?? null, autoTitle: x.autoTitle, team: t(x.teamId) })),
    playlists: lib.playlists.map(x => ({ game: g(x.gameId), name: x.name, emoji: x.emoji })),
    clips: lib.clips.map(x => ({
      id: x.id, label: x.label, videoId: x.videoId ?? null, game: g(x.gameId),
      playlist: lib.playlists.find(p => p.id === x.playlistId)?.name ?? null,
    })),
  };
}

/* What classic Angl's Import button does with this file. */
function classic(file: Lib) {
  const app = loadApp();
  app.clips = clone(file.clips); app.playlists = clone(file.playlists);
  app.games = clone(file.games); app.teams = clone(file.teams);
  if (!app.games.length) app.migrateToGames(null);
  app.migrateToTeams();
  return clone({ clips: app.clips, playlists: app.playlists, games: app.games, teams: app.teams });
}

function ported(file: Lib): Lib {
  const lib = libraryFromExport(clone(file));
  assert.ok(lib);
  return lib as Lib;
}

const fixtures: Record<string, Lib> = {
  'version 1: flat playlists, films only on the clips': {
    clips: [
      { id: 'c1', label: 'Closeout', videoId: 'vidAAAAAAAA', playlistId: 'p1', start: 10, end: 20, bufBefore: 2, bufAfter: 2, effStart: 8, effEnd: 22 },
      { id: 'c2', label: 'Press', videoId: 'vidBBBBBBBB', playlistId: 'p1', start: 30, end: 40, bufBefore: 2, bufAfter: 2, effStart: 28, effEnd: 42 },
      { id: 'c3', label: 'Break', videoId: 'vidAAAAAAAA', playlistId: 'p2', start: 50, end: 60, bufBefore: 0, bufAfter: 0, effStart: 50, effEnd: 60 },
    ],
    playlists: [
      { id: 'p1', name: 'Defence', emoji: '🛡️' },
      { id: 'p2', name: 'Transition', emoji: '⚡' },
      { id: 'p3', name: 'Never used', emoji: '📌' },
    ],
    games: [], teams: [],
  },
  'version 1: a clip with no film and a playlist that is gone': {
    clips: [
      { id: 'c1', label: 'Mystery', playlistId: 'gone', start: 5, end: 9, bufBefore: 1, bufAfter: 1, effStart: 4, effEnd: 10 },
      { id: 'c2', label: 'Known', videoId: 'vidAAAAAAAA', playlistId: 'p1', start: 5, end: 9, bufBefore: 1, bufAfter: 1, effStart: 4, effEnd: 10 },
    ],
    playlists: [{ id: 'p1', name: 'Offence', emoji: '⚡' }],
    games: [], teams: [],
  },
  'categories set up before the first clip': {
    clips: [],
    playlists: [{ id: 'p1', name: 'Offence', emoji: '⚡' }, { id: 'p2', name: 'Defence', emoji: '🛡️' }],
    games: [], teams: [],
  },
  'version 2: games but no teams': {
    clips: [{ id: 'c1', label: 'A', videoId: 'vidAAAAAAAA', gameId: 'g1', playlistId: 'p1', start: 1, end: 2, effStart: 0, effEnd: 4 }],
    playlists: [{ id: 'p1', gameId: 'g1', name: 'Defence', emoji: '🛡️' }],
    games: [{ id: 'g1', title: 'Round 7', videoId: 'vidAAAAAAAA', createdAt: 1 }, { id: 'g2', title: 'Round 8', videoId: 'vidBBBBBBBB', createdAt: 2 }],
    teams: [],
  },
  'version 4: fully migrated, two teams': {
    clips: [
      { id: 'c1', label: 'A', videoId: 'vidAAAAAAAA', gameId: 'g1', playlistId: 'p1', start: 1, end: 2, effStart: 0, effEnd: 4 },
      { id: 'c2', label: 'B', videoId: 'vidBBBBBBBB', gameId: 'g2', playlistId: 'p2', start: 1, end: 2, effStart: 0, effEnd: 4 },
    ],
    playlists: [{ id: 'p1', gameId: 'g1', name: 'Defence', emoji: '🛡️' }, { id: 'p2', gameId: 'g2', name: 'Attack', emoji: '⚡' }],
    games: [{ id: 'g1', teamId: 't1', title: 'Round 7', videoId: 'vidAAAAAAAA' }, { id: 'g2', teamId: 't2', title: 'Netball R1', videoId: 'vidBBBBBBBB' }],
    teams: [{ id: 't1', name: 'U16 Boys', sport: 'basketball' }, { id: 't2', name: 'U14 Girls', sport: 'netball' }],
  },
  'a half-migrated library: one game has a team, one does not': {
    clips: [],
    playlists: [],
    games: [{ id: 'g1', teamId: 't1', title: 'Owned' }, { id: 'g2', title: 'Orphan' }],
    teams: [{ id: 't1', name: 'Seniors' }],
  },
};

for (const [name, file] of Object.entries(fixtures)) {
  test(`same result as classic Angl: ${name}`, () => {
    assert.deepEqual(shape(ported(file)), shape(classic(file)));
  });
}

test('the input file is never mutated', () => {
  const file = fixtures['version 1: flat playlists, films only on the clips']!;
  const before = JSON.stringify(file);
  ported(file);
  assert.equal(JSON.stringify(file), before);
});

test('a file that is not an Angl export is refused', () => {
  assert.equal(libraryFromExport({ hello: 'world' }), null);
  assert.equal(libraryFromExport([]), null);
  assert.equal(libraryFromExport(null), null);
});

test('an empty library is left alone: no team, no game', () => {
  const lib: LegacyLibrary = { clips: [], playlists: [], games: [], teams: [] };
  migrateToGames(lib, null);
  migrateToTeams(lib);
  assert.deepEqual(lib, { clips: [], playlists: [], games: [], teams: [] });
});

test('clip ids survive the migration untouched', () => {
  const lib = ported(fixtures['version 1: flat playlists, films only on the clips']!);
  assert.deepEqual(lib.clips.map(c => c.id), ['c1', 'c2', 'c3']);
});
