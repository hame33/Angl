/*
 * A team owns a sport, and the sport owns every word Angl assumes. These tests
 * are mostly about what a profile must NOT do: netball must not inherit
 * basketball's vocabulary, a team saved before profiles existed must not be
 * relabelled, and changing a team's sport must not touch a clip already cut.
 *
 *   node --test tests/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './load-app.mjs';

/* A team, its game, and that game on screen — enough for the parser to know
 * which sport it is listening to. */
function appFor(sport) {
  const app = loadApp();
  app.settings = Object.assign({}, app.settings, { smartDurations: true });
  app.durationModel = app.emptyDurationModel();
  const team = { id: 't1', name: 'Test team', createdAt: 1 };
  if (sport !== undefined) team.sport = sport;
  app.teams = [team];
  app.games = [{ id: 'g1', title: 'Test game', videoId: 'v1', teamId: 't1' }];
  app.playlists = [];
  app.clips = [];
  app.activeTeam = 't1';
  app.loadedGameId = 'g1';
  return app;
}

/* ── Which profile a team gets ────────────────────────────────────────────── */

test('a team with no stored sport reads as basketball', () => {
  const app = appFor(undefined);                 // the shape every pre-profile team has
  assert.equal(app.teams[0].sport, undefined, 'the fixture must not carry a sport');
  assert.equal(app.teamProfile(app.teams[0]).id, 'basketball');
  assert.equal(app.activeProfile().id, 'basketball');
});

test('an unknown sport falls back to basketball rather than breaking', () => {
  const app = appFor('underwater hockey');
  assert.equal(app.teamProfile(app.teams[0]).id, 'basketball');
});

test('no team at all still resolves to a profile', () => {
  const app = appFor(undefined);
  app.teams = [];
  app.activeTeam = null;
  assert.equal(app.activeProfile().id, 'basketball');
});

test('reading a team\'s profile never writes a sport back onto it', () => {
  const app = appFor(undefined);
  app.activeProfile();
  app.teamProfile(app.teams[0]);
  assert.ok(!('sport' in app.teams[0]),
    'a pre-profile team must stay exactly as it was stored');
});

/* ── Protected vocabulary is per sport ────────────────────────────────────── */

test('basketball protects "long two" from being read as a length', () => {
  const app = appFor('basketball');
  const c = app.parseDictation('at 15:34 long two');
  assert.equal(c.label, 'Long two', 'the shot keeps its name');
  assert.notEqual(c.durationSource, 'keyword', '"long" here is not a length word');
});

test('a netball profile does not protect basketball vocabulary', () => {
  const app = appFor('netball');
  const c = app.parseDictation('at 15:34 long two');
  // Nothing in netball claims "long two", so "long" is a length word again
  assert.equal(c.durationSecs, 15);
  assert.equal(c.durationSource, 'keyword');
  assert.equal(c.label, 'Two');
});

test('netball protects its own wording instead', () => {
  const app = appFor('netball');
  const c = app.parseDictation('at 15:34 long pass into the circle');
  assert.equal(c.label, 'Long pass into the circle');
  assert.notEqual(c.durationSource, 'keyword');
});

test('basketball does not protect netball vocabulary', () => {
  const app = appFor('basketball');
  const c = app.parseDictation('at 15:34 long pass');
  assert.equal(c.durationSecs, 15);
  assert.equal(c.durationSource, 'keyword');
  assert.equal(c.label, 'Pass');
});

test('a protected phrase is protected wherever it falls in the label', () => {
  const app = appFor('basketball');
  const c = app.parseDictation('at 15:34 contested long two off the switch');
  assert.equal(c.label, 'Contested long two off the switch');
});

test('a length word outside any protected phrase still sets the length', () => {
  const app = appFor('basketball');
  const c = app.parseDictation('at 15:34 long pull up');
  assert.equal(c.durationSecs, 15, '"long" on its own is still fifteen seconds');
  assert.equal(c.durationSource, 'keyword');
  assert.equal(c.label, 'Pull up');
});

test('a stated length still wins, and the protected label survives it', () => {
  const app = appFor('basketball');
  const c = app.parseDictation('at 15:34 for 20 seconds long two');
  assert.equal(c.durationSecs, 20);
  assert.equal(c.durationSource, 'explicit');
  assert.equal(c.label, 'Long two');
});

test('"and one" survives the hour form that arms the number reader', () => {
  const app = appFor('basketball');
  const c = app.parseDictation('at an hour and one');
  assert.equal(c.start, 3600, 'the hour is still an hour');
  assert.equal(c.label, 'And one', 'the shot is not read as sixty-one seconds');
});

test('the hour forms the README documents are untouched by the guard', () => {
  const app = appFor('basketball');
  assert.equal(app.parseDictation('an hour and 42 seconds rebound').start, 3642);
  assert.equal(app.parseDictation('1 hour 2 minutes 5 seconds').start, 3725);
  assert.equal(app.parseDictation('sixty two minutes 41 seconds').start, 3761);
  assert.equal(app.parseDictation('105:30 buzzer').start, 6330);
});

/* ── Length words are per sport ───────────────────────────────────────────── */

test('basketball has a shot clock and netball does not', () => {
  const bball = appFor('basketball').parseDictation('at 15:34 possession arrow');
  assert.equal(bball.durationSecs, 24);
  assert.equal(bball.durationSource, 'keyword');

  const net = appFor('netball').parseDictation('at 15:34 possession arrow');
  assert.notEqual(net.durationSource, 'keyword', 'netball has no shot clock to name');
  assert.equal(net.label, 'Possession arrow', 'so the word stays in the label');
});

/* ── Switching sports leaves the record alone ─────────────────────────────── */

test('switching a team\'s profile does not alter clips already saved', () => {
  const app = appFor('basketball');
  app.playlists = [{ id: 'pl1', gameId: 'g1', name: 'Offence', emoji: '⚡' }];
  const before = [
    { id: 'c1', gameId: 'g1', playlistId: 'pl1', label: 'Long two', videoId: 'v1',
      start: 934, end: 949, bufBefore: 0, bufAfter: 0, effStart: 934, effEnd: 949 },
    { id: 'c2', gameId: 'g1', playlistId: 'pl1', label: 'Pick and roll', videoId: 'v1',
      start: 100, end: 110, bufBefore: 2, bufAfter: 1, effStart: 98, effEnd: 111 },
  ];
  app.clips = before.map(c => Object.assign({}, c));

  app.setTeamSport('t1', 'netball');

  assert.equal(app.teams[0].sport, 'netball', 'the team did change');
  assert.deepEqual(app.clips, before, 'every saved clip is byte-for-byte what it was');
  assert.deepEqual(app.playlists, [{ id: 'pl1', gameId: 'g1', name: 'Offence', emoji: '⚡' }],
    'existing playlists keep the names the coach gave them');
  assert.equal(app.games.length, 1, 'no game was added or dropped');
});

test('switching sports changes only what happens next', () => {
  const app = appFor('basketball');
  assert.equal(app.parseDictation('at 15:34 long two').label, 'Long two');
  app.setTeamSport('t1', 'netball');
  assert.equal(app.parseDictation('at 15:34 long two').label, 'Two',
    'the new sport does not claim the old sport\'s wording');
  assert.equal(app.parseDictation('at 15:34 long pass').label, 'Long pass');
});

test('a new team is stored with its sport, and an existing name is refused', () => {
  const app = appFor('basketball');
  app.teams = [];
  app.createTeam('Thistle U16', 'netball');
  assert.equal(app.teams.length, 1);
  assert.equal(app.teams[0].sport, 'netball');
  assert.equal(app.teams[0].name, 'Thistle U16');

  app.createTeam('thistle u16', 'basketball');
  assert.equal(app.teams.length, 1, 'a duplicate name is still refused');
  assert.equal(app.teams[0].sport, 'netball', 'and the original is not overwritten');
});

test('a team created with no sport named is basketball', () => {
  const app = appFor('basketball');
  app.teams = [];
  app.createTeam('Unnamed sport');
  assert.equal(app.teams[0].sport, 'basketball');
});

/* ── Seeding ──────────────────────────────────────────────────────────────── */

test('a team\'s first game is seeded with its own sport\'s categories', () => {
  const app = appFor('netball');
  app.playlists = [];
  app.seedPlaylists('g1', 't1');
  assert.deepEqual(app.playlists.map(p => p.name), ['Attack', 'Defence', 'Highlights']);

  const bb = appFor('basketball');
  bb.playlists = [];
  bb.seedPlaylists('g1', 't1');
  assert.deepEqual(bb.playlists.map(p => p.name), ['Offence', 'Defence', 'Highlights']);
});

/* ── A library saved before sports existed ───────────────────────────────── */

test('a pre-profile library loads, reads as basketball, and is written back unchanged', () => {
  const app = loadApp();
  const teams = [{ id: 't1', name: 'U16 Girls 2025', createdAt: 1 }];        // no sport
  const games = [{ id: 'g1', teamId: 't1', title: 'Round 7', videoId: 'v1', createdAt: 2 }];
  const pls   = [{ id: 'p1', gameId: 'g1', name: 'Offence', emoji: '\u26a1' }];
  const clips = [{ id: 'c1', gameId: 'g1', playlistId: 'p1', label: 'Long two', videoId: 'v1',
                   start: 934, end: 949, bufBefore: 0, bufAfter: 0, effStart: 934, effEnd: 949 }];
  app.__storageSet('filmroom_teams',     JSON.stringify(teams));
  app.__storageSet('filmroom_games',     JSON.stringify(games));
  app.__storageSet('filmroom_playlists', JSON.stringify(pls));
  app.__storageSet('filmroom_clips',     JSON.stringify(clips));

  app.loadFromStorage();

  // Objects parsed inside the sandbox carry its Object prototype, not this
  // realm's, so compare them as plain data rather than by identity of shape.
  const plain = v => JSON.parse(JSON.stringify(v));
  assert.deepEqual(plain(app.teams), teams, 'no sport was invented on the way in');
  assert.equal(app.teamProfile(app.teams[0]).id, 'basketball');
  assert.deepEqual(plain(app.clips), clips, 'every stored clip survived the load');

  app.saveToStorage();
  assert.deepEqual(JSON.parse(app.__storageGet('filmroom_clips')), clips,
    'and the save wrote them back exactly as they were');
  assert.deepEqual(JSON.parse(app.__storageGet('filmroom_teams')), teams,
    'a team with no sport is stored with no sport');
});

test('sports added no new storage key', () => {
  const app = loadApp();
  app.teams = [{ id: 't1', name: 'T', sport: 'netball', createdAt: 1 }];
  app.saveToStorage();
  const written = app.__storageKeys();
  for (const k of written) {
    assert.ok(k.startsWith('filmroom_'), k + ' must keep the filmroom_ prefix');
  }
  assert.ok(!written.some(k => /sport|profile/i.test(k)),
    'the sport rides on the team, it does not get a key of its own');
  // and it does ride on the team
  assert.equal(JSON.parse(app.__storageGet('filmroom_teams'))[0].sport, 'netball');
});

/* ── The prompt the LLM is given ──────────────────────────────────────────── */

test('the prompt names the team\'s sport and its own protected wording', () => {
  const bb = appFor('basketball');
  bb.playlists = [{ id: 'p1', gameId: 'g1', name: 'Offence', emoji: '\u26a1' }];
  const p = bb.buildParserPrompt('15:34 long two');
  assert.match(p, /You turn a basketball coach's spoken clip notes into JSON\./);
  assert.match(p, /Lengths: short=5s, medium=10s, long=15s, possession=24s\./);
  assert.match(p, /keep basketball wording intact \("long two" and "and one"/);

  const net = appFor('netball');
  net.playlists = [{ id: 'p1', gameId: 'g1', name: 'Attack', emoji: '\u26a1' }];
  const q = net.buildParserPrompt('15:34 long pass');
  assert.match(q, /You turn a netball coach's spoken clip notes into JSON\./);
  assert.match(q, /Lengths: short=5s, medium=10s, long=15s\./);
  assert.match(q, /keep netball wording intact \("long pass", "short pass" and "long ball"/);
});

test('no basketball wording reaches a netball coach\'s prompt', () => {
  const net = appFor('netball');
  net.playlists = [{ id: 'p1', gameId: 'g1', name: 'Attack', emoji: '\u26a1' }];
  const q = net.buildParserPrompt('15:34 centre pass');
  for (const word of ['basketball', 'possession', 'long two', 'and one', 'Pick and roll', 'Offence']) {
    assert.ok(!q.includes(word), 'the netball prompt must not mention ' + JSON.stringify(word));
  }
});

/* ── The profiles themselves ──────────────────────────────────────────────── */

test('every profile carries the whole shape, so no lookup can come back undefined', () => {
  for (const [id, p] of Object.entries(app0().SPORT_PROFILES)) {
    assert.equal(p.id, id, id + ' must know its own key');
    for (const field of ['name', 'sportNoun', 'defaultEmoji', 'categories',
                         'fallbackCategory', 'protectedPhrases', 'durationWords',
                         'labelPlaceholder', 'promptExample', 'probeTranscript']) {
      assert.ok(p[field] !== undefined, id + ' is missing ' + field);
    }
    assert.ok(p.categories.length, id + ' needs at least one category');
    assert.ok(p.durationWords.length, id + ' needs at least one length word');
    assert.ok(p.fallbackCategory.name && p.fallbackCategory.emoji,
      id + ' needs a complete fallback category');
    assert.ok(p.promptExample.label && p.promptExample.playlist,
      id + ' needs a complete prompt example');
  }
});

let _shared = null;
function app0() { return (_shared = _shared || loadApp()); }
