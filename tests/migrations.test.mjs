/*
 * The migrations are the code most likely to quietly eat a season: they run
 * once, on a library the coach cannot see, and a mistake looks like an empty
 * film room rather than an error. Nothing covered them until now.
 *
 * These tests are written against the two shapes that actually exist in the
 * wild — a library saved before games existed, and one saved before teams did
 * — plus the guards that stop a migrated library being migrated again.
 *
 *   node --test tests/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './load-app.mjs';

/* Objects parsed inside the sandbox carry its Object prototype, not this
 * realm's, so compare them as data rather than by identity of shape. */
const plain = v => JSON.parse(JSON.stringify(v));

/* Seed storage the way a browser would have left it, then load. */
function libraryOf(parts) {
  const app = loadApp();
  for (const [key, value] of Object.entries(parts)) {
    app.__storageSet(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
  return app;
}

/* ── migrateToTeams ───────────────────────────────────────────────────────── */

test('a pre-teams library gains exactly one team and loses no clips', () => {
  const clips = [
    { id: 'c1', gameId: 'g1', playlistId: 'p1', label: 'Kept', start: 10, end: 20 },
    { id: 'c2', gameId: 'g2', playlistId: 'p2', label: 'Also kept', start: 30, end: 40 },
  ];
  const app = libraryOf({
    filmroom_games: [                                   // games, but no teamId on any
      { id: 'g1', title: 'Round 6', videoId: 'v1', createdAt: 1 },
      { id: 'g2', title: 'Round 7', videoId: 'v2', createdAt: 2 },
    ],
    filmroom_playlists: [
      { id: 'p1', gameId: 'g1', name: 'Defence', emoji: '🛡️' },
      { id: 'p2', gameId: 'g2', name: 'Defence', emoji: '🛡️' },
    ],
    filmroom_clips: clips,
  });

  app.loadFromStorage();

  assert.equal(app.teams.length, 1, 'exactly one team, not one per game');
  assert.equal(app.teams[0].name, 'My team');
  assert.equal(app.games.length, 2, 'no game was invented or dropped');
  for (const g of app.games) {
    assert.equal(g.teamId, app.teams[0].id, g.title + ' must belong to the new team');
  }
  assert.deepEqual(plain(app.clips), clips, 'not one clip changed');
  assert.equal(app.playlists.length, 2, 'playlists were not rebuilt');
});

test('orphaned games join the team that is already there rather than making another', () => {
  const app = loadApp();
  app.teams = [{ id: 't9', name: 'Senior Women', createdAt: 1 }];
  app.games = [
    { id: 'g1', title: 'Has a team', videoId: 'v1', teamId: 't9' },
    { id: 'g2', title: 'Orphan',     videoId: 'v2' },
  ];

  app.migrateToTeams();

  assert.equal(app.teams.length, 1, 'no second team');
  assert.equal(app.teams[0].name, 'Senior Women', 'and the real one was not renamed');
  assert.equal(app.games[1].teamId, 't9', 'the orphan was adopted');
});

test('a library that is already migrated is left exactly alone', () => {
  const app = loadApp();
  const teams = [{ id: 't1', name: 'U16 Girls', createdAt: 1 }];
  const games = [{ id: 'g1', title: 'Round 7', videoId: 'v1', teamId: 't1', createdAt: 2 }];
  app.teams = teams.map(t => Object.assign({}, t));
  app.games = games.map(g => Object.assign({}, g));

  app.migrateToTeams();
  app.migrateToTeams();                                 // twice, deliberately

  assert.deepEqual(plain(app.teams), teams, 'no team was added or touched');
  assert.deepEqual(plain(app.games), games, 'no game was touched');
});

test('a genuinely empty library gets no team at all', () => {
  const app = loadApp();
  app.migrateToTeams();
  assert.equal(app.teams.length, 0,
    'a fresh install has nothing to own, so inventing "My team" would be noise');
});

test('a half-migrated library only has its orphans touched', () => {
  const app = loadApp();
  app.teams = [{ id: 't1', name: 'Kept', createdAt: 1 }];
  app.games = [
    { id: 'g1', title: 'Owned',  videoId: 'v1', teamId: 't1' },
    { id: 'g2', title: 'Orphan', videoId: 'v2', teamId: '' },   // falsy counts as orphan
  ];

  app.migrateToTeams();

  assert.equal(app.games[0].teamId, 't1');
  assert.equal(app.games[1].teamId, 't1');
  assert.equal(app.teams.length, 1);
});

/* ── migrateToGames ───────────────────────────────────────────────────────── */

test('a pre-games library keyed to a single video is grouped into one game', () => {
  const app = libraryOf({
    filmroom_clips: [
      { id: 'c1', playlistId: 'p1', label: 'A', start: 10, end: 20 },
      { id: 'c2', playlistId: 'p2', label: 'B', start: 30, end: 40 },
      { id: 'c3', playlistId: 'p1', label: 'C', start: 50, end: 60 },
    ],
    filmroom_playlists: [
      { id: 'p1', name: 'Defence', emoji: '🛡️' },
      { id: 'p2', name: 'Offence', emoji: '⚡' },
    ],
    filmroom_video: 'VID1',                             // the one film the library was
  });

  app.loadFromStorage();

  assert.equal(app.games.length, 1, 'one film is one game');
  const game = app.games[0];
  assert.equal(game.videoId, 'VID1');
  assert.equal(game.title, 'Game 1');
  assert.equal(game.autoTitle, true, 'so the player can supply the real title later');

  assert.equal(app.clips.length, 3, 'every clip survived');
  for (const c of app.clips) {
    assert.equal(c.gameId, game.id, c.id + ' belongs to the new game');
    assert.equal(c.videoId, 'VID1', c.id + ' had its film backfilled');
  }
  assert.deepEqual(plain(app.clips.map(c => c.label)), ['A', 'B', 'C'], 'in the order they were');

  const names = plain(app.playlists.map(p => p.name)).sort();
  assert.deepEqual(names, ['Defence', 'Offence'], 'both categories came across');
  for (const pl of app.playlists) assert.equal(pl.gameId, game.id);

  // The clips still point at the right category, under its rebuilt id
  const byName = Object.fromEntries(app.playlists.map(p => [p.name, p.id]));
  assert.equal(app.clips.find(c => c.id === 'c1').playlistId, byName.Defence);
  assert.equal(app.clips.find(c => c.id === 'c2').playlistId, byName.Offence);
  assert.equal(app.clips.find(c => c.id === 'c3').playlistId, byName.Defence);
});

test('a category that never held a clip still survives the upgrade', () => {
  const app = libraryOf({
    filmroom_clips: [{ id: 'c1', playlistId: 'p1' }],
    filmroom_playlists: [
      { id: 'p1', name: 'Defence',   emoji: '🛡️' },
      { id: 'p2', name: 'Set plays', emoji: '🎯' },     // the coach set it up, never used it
    ],
    filmroom_video: 'VID1',
  });

  app.loadFromStorage();

  const names = plain(app.playlists.map(p => p.name)).sort();
  assert.deepEqual(names, ['Defence', 'Set plays'],
    'a category the coach made is theirs, clipped into or not');
});

test('clip ids are preserved and playlist ids are rebuilt', () => {
  const app = libraryOf({
    filmroom_clips: [{ id: 'keep-me', playlistId: 'p1', label: 'Mine' }],
    filmroom_playlists: [{ id: 'p1', name: 'Defence', emoji: '🛡️' }],
    filmroom_video: 'VID1',
  });

  app.loadFromStorage();

  assert.equal(app.clips[0].id, 'keep-me', 'a clip keeps its identity');
  assert.notEqual(app.playlists[0].id, 'p1', 'a playlist is rebuilt per game, so it gets a new id');
  assert.equal(app.clips[0].playlistId, app.playlists[0].id, 'and the clip follows it');
});

test('several films become several games, numbered in the order they first appear', () => {
  const app = libraryOf({
    filmroom_clips: [
      { id: 'c1', playlistId: 'p1', videoId: 'AAA' },
      { id: 'c2', playlistId: 'p1', videoId: 'BBB' },
      { id: 'c3', playlistId: 'p1', videoId: 'AAA' },
    ],
    filmroom_playlists: [{ id: 'p1', name: 'Defence', emoji: '🛡️' }],
  });

  app.loadFromStorage();

  assert.deepEqual(plain(app.games.map(g => [g.title, g.videoId])),
    [['Game 1', 'AAA'], ['Game 2', 'BBB']]);
  assert.equal(app.playlists.length, 2,
    'one Defence per game — the dashboard rolls them back up by name');
  assert.deepEqual(plain(app.playlists.map(p => p.name)), ['Defence', 'Defence']);
  assert.equal(app.clips.filter(c => c.gameId === app.games[0].id).length, 2);
  assert.equal(app.clips.filter(c => c.gameId === app.games[1].id).length, 1);
});

test('a clip pointing at a playlist that is gone still lands somewhere', () => {
  const app = libraryOf({
    filmroom_clips: [{ id: 'c1', playlistId: 'vanished', label: 'Orphan clip' }],
    filmroom_playlists: [],
    filmroom_video: 'VID1',
  });

  app.loadFromStorage();

  assert.equal(app.clips.length, 1, 'the clip is not dropped for pointing at nothing');
  assert.equal(app.playlists.length, 1);
  assert.equal(app.playlists[0].name, 'General');
  assert.equal(app.clips[0].playlistId, app.playlists[0].id);
});

test('a film that was loaded but never clipped is still kept', () => {
  const app = libraryOf({ filmroom_video: 'VID1' });

  app.loadFromStorage();

  assert.equal(app.games.length, 1, 'the film the coach had open is worth keeping');
  assert.equal(app.games[0].videoId, 'VID1');
  assert.equal(app.playlists.length, 1, 'with somewhere to put the first clip');
  assert.equal(app.playlists[0].name, 'General');
});

/* ── Ordering, and the guards that stop a second migration ────────────────── */

test('games are migrated before teams, so every rebuilt game gets an owner', () => {
  const app = libraryOf({
    filmroom_clips: [{ id: 'c1', playlistId: 'p1' }],
    filmroom_playlists: [{ id: 'p1', name: 'Defence', emoji: '🛡️' }],
    filmroom_video: 'VID1',
  });

  app.loadFromStorage();

  assert.equal(app.teams.length, 1, 'the team migration ran after the game migration');
  assert.ok(app.games.every(g => g.teamId === app.teams[0].id),
    'a game rebuilt from a v1 library must not be left orphaned');
});

test('loading a migrated library twice does not migrate it twice', () => {
  const app = libraryOf({
    filmroom_clips: [{ id: 'c1', playlistId: 'p1' }],
    filmroom_playlists: [{ id: 'p1', name: 'Defence', emoji: '🛡️' }],
    filmroom_video: 'VID1',
  });

  app.loadFromStorage();
  app.saveToStorage();                                  // as the app does after migrating
  const after = {
    games: plain(app.games), teams: plain(app.teams),
    playlists: plain(app.playlists), clips: plain(app.clips),
  };

  app.loadFromStorage();                                // a second visit to the page

  assert.deepEqual(plain(app.games), after.games, 'no second game');
  assert.deepEqual(plain(app.teams), after.teams, 'no second team');
  assert.deepEqual(plain(app.playlists), after.playlists, 'playlists were not rebuilt again');
  assert.deepEqual(plain(app.clips), after.clips, 'clips were not re-pointed');
});

test('a stale legacy video pointer cannot resurrect a game once games exist', () => {
  const app = libraryOf({
    filmroom_teams: [{ id: 't1', name: 'U16', createdAt: 1 }],
    filmroom_games: [{ id: 'g1', title: 'Round 7', videoId: 'v1', teamId: 't1', createdAt: 2 }],
    filmroom_playlists: [{ id: 'p1', gameId: 'g1', name: 'Defence', emoji: '🛡️' }],
    filmroom_clips: [{ id: 'c1', gameId: 'g1', playlistId: 'p1' }],
    filmroom_video: 'OLD-FILM',                         // never cleared, still on disk
  });

  app.loadFromStorage();

  assert.equal(app.games.length, 1, 'the guard is games.length, and there is one');
  assert.equal(app.games[0].title, 'Round 7');
  assert.equal(app.playlists.length, 1, 'and the playlists were not thrown away and rebuilt');
});

/* ── One bad key costs its own data and nothing else ──────────────────────── */

test('a corrupt clips key loses the clips and nothing else', () => {
  const app = libraryOf({
    filmroom_clips: '{not json at all',
    filmroom_playlists: [{ id: 'p1', gameId: 'g1', name: 'Defence', emoji: '🛡️' }],
    filmroom_games: [{ id: 'g1', title: 'Round 7', videoId: 'v1', teamId: 't1', createdAt: 2 }],
    filmroom_teams: [{ id: 't1', name: 'U16 Girls', createdAt: 1 }],
  });

  app.loadFromStorage();

  assert.deepEqual(plain(app.clips), [], 'the unreadable key is the one that empties');
  assert.equal(app.playlists.length, 1, 'playlists survived');
  assert.equal(app.games.length, 1, 'games survived');
  assert.equal(app.teams.length, 1, 'teams survived');
  assert.equal(app.__storageGet('filmroom_clips_corrupt'), '{not json at all',
    'the raw text is kept verbatim, because it is the only copy left');
});

test('the surviving keys are still written back intact after a corrupt one', () => {
  const app = libraryOf({
    filmroom_clips: '{not json at all',
    filmroom_games: [{ id: 'g1', title: 'Round 7', videoId: 'v1', teamId: 't1', createdAt: 2 }],
    filmroom_teams: [{ id: 't1', name: 'U16 Girls', createdAt: 1 }],
  });

  app.loadFromStorage();
  app.saveToStorage();

  assert.equal(JSON.parse(app.__storageGet('filmroom_games')).length, 1,
    'the next save must not zero the keys that were fine');
  assert.equal(JSON.parse(app.__storageGet('filmroom_teams'))[0].name, 'U16 Girls');
});

test('valid JSON of the wrong shape is treated as corrupt, not trusted', () => {
  const app = libraryOf({
    filmroom_clips: '{"clips":"not an array"}',
    filmroom_teams: [{ id: 't1', name: 'U16 Girls', createdAt: 1 }],
  });

  app.loadFromStorage();

  assert.deepEqual(plain(app.clips), [], 'an object where an array belongs is not usable');
  assert.equal(app.__storageGet('filmroom_clips_corrupt'), '{"clips":"not an array"}');
  assert.equal(app.teams.length, 1, 'and it still costs nothing else');
});

test('an absent key is not corrupt, and leaves no _corrupt twin', () => {
  const app = libraryOf({ filmroom_teams: [{ id: 't1', name: 'U16', createdAt: 1 }] });

  app.loadFromStorage();

  assert.equal(app.__storageGet('filmroom_clips_corrupt'), null,
    'nothing stored is not the same as something unreadable');
  assert.deepEqual(plain(app.clips), []);
});

test('readStoredList tells apart nothing, unreadable, and real data', () => {
  const app = loadApp();
  assert.equal(app.readStoredList('filmroom_missing'), null, 'null = nothing stored');
  app.__storageSet('filmroom_bad', 'nonsense{');
  assert.equal(app.readStoredList('filmroom_bad'), false, 'false = stored but unreadable');
  app.__storageSet('filmroom_good', '[{"id":"x"}]');
  assert.deepEqual(plain(app.readStoredList('filmroom_good')), [{ id: 'x' }]);
});

test('a full disk cannot stop a corrupt key being reported', () => {
  const app = loadApp();
  app.__storageSet('filmroom_clips', '{not json');
  app.__failWritesTo('filmroom_clips_corrupt');         // no room to keep the raw text

  // The twin cannot be written, but the read must still refuse the bad value
  assert.equal(app.readStoredList('filmroom_clips'), false);
  assert.equal(app.__storageGet('filmroom_clips_corrupt'), null);
  app.__allowAllWrites();
});
