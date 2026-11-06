import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error -- classic Angl's test sandbox is plain JS
import { loadApp } from '../../tests/load-app.mjs';
import { newItems, fingerprint, legacyToV5 } from './to-v5.ts';
import { readLegacy, type ReadOnlyStorage } from './read.ts';

/* A browser's localStorage as classic Angl leaves it. Every method call is
 * recorded, so a test can prove only getItem was ever used. */
function storage(entries: Record<string, unknown>) {
  const map = new Map(Object.entries(entries).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  const calls = new Set<string>();
  const real = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
  const watched = new Proxy(real, { get(t, p, r) { calls.add(String(p)); return Reflect.get(t, p, r); } });
  return { store: watched as ReadOnlyStorage, map, calls, snapshot: () => JSON.stringify([...map].sort()) };
}

const shapes: Record<string, Record<string, unknown>> = {
  'pre-games (flat playlists, one video key)': {
    filmroom_clips: [
      { id: 'c1', label: 'Closeout', playlistId: 'p1', start: 10, end: 20, bufBefore: 2, bufAfter: 2, effStart: 8, effEnd: 22 },
      { id: 'c2', label: 'Press', playlistId: 'p2', start: 30, end: 40, bufBefore: 2, bufAfter: 2, effStart: 28, effEnd: 42 },
    ],
    filmroom_playlists: [{ id: 'p1', name: 'Defence', emoji: '🛡️' }, { id: 'p2', name: 'Offence', emoji: '⚡' }, { id: 'p3', name: 'Unused', emoji: '📌' }],
    filmroom_video: 'bJJy8l6tVAI',
  },
  'pre-teams (games, no teams)': {
    filmroom_clips: [{ id: 'c1', label: 'A', videoId: 'bJJy8l6tVAI', gameId: 'g1', playlistId: 'p1', start: 1, end: 2, effStart: 0, effEnd: 4 }],
    filmroom_playlists: [{ id: 'p1', gameId: 'g1', name: 'Defence', emoji: '🛡️' }],
    filmroom_games: [{ id: 'g1', title: 'Round 7', videoId: 'bJJy8l6tVAI', createdAt: 1700000000000 }],
  },
  'current (teams, games, playlists)': {
    filmroom_clips: [
      { id: 'c1', label: 'A', videoId: 'bJJy8l6tVAI', gameId: 'g1', playlistId: 'p1', start: 1, end: 2, effStart: 0, effEnd: 4 },
      { id: 'c2', label: 'B', videoId: 'dQw4w9WgXcQ', gameId: 'g2', playlistId: 'p2', start: 5, end: 9, effStart: 3, effEnd: 11 },
    ],
    filmroom_playlists: [{ id: 'p1', gameId: 'g1', name: 'Defence', emoji: '🛡️' }, { id: 'p2', gameId: 'g2', name: 'Attack', emoji: '⚡' }],
    filmroom_games: [{ id: 'g1', teamId: 't1', title: 'Round 7', videoId: 'bJJy8l6tVAI', createdAt: 1700000000000 }, { id: 'g2', teamId: 't2', title: 'Netball R1', videoId: 'dQw4w9WgXcQ', createdAt: 1700000100000 }],
    filmroom_teams: [{ id: 't1', name: 'U16 Boys', sport: 'basketball' }, { id: 't2', name: 'U14 Girls', sport: 'netball' }],
    filmroom_active_game: 'g1',
    filmroom_duration_model: { version: 1, backfilled: true, global: { n: 0, durations: [] }, categories: {}, tokens: {} },
    filmroom_dictation_log: [{ v: 1, at: 1, outcome: 'missed', heard: 'fifteen' }],
    filmroom_settings: { parser: 'builtin', apiKey: '' },
    filmroom_hotkey: 'AltRight',
  },
};

/* By structure, since migrated ids are random in classic Angl and counters here */
function shape(lib: { clips: any[]; playlists: any[]; games: any[]; teams: any[] }) {
  const g = (id: string) => lib.games.findIndex(x => x.id === id);
  return {
    teams: lib.teams.map(t => ({ name: t.name, sport: t.sport ?? null })),
    games: lib.games.map(x => ({ title: x.title, videoId: x.videoId ?? null, team: lib.teams.findIndex(t => t.id === x.teamId) })),
    playlists: lib.playlists.map(p => ({ game: g(p.gameId), name: p.name })),
    clips: lib.clips.map(c => ({ id: c.id, game: g(c.gameId), playlist: lib.playlists.find(p => p.id === c.playlistId)?.name ?? null })),
  };
}

for (const [name, entries] of Object.entries(shapes)) {
  test(`reads a ${name} library exactly as classic Angl loads it`, () => {
    const app = loadApp();
    for (const [k, v] of Object.entries(entries)) app.__storageSet(k, typeof v === 'string' ? v : JSON.stringify(v));
    app.loadFromStorage();
    const classic = JSON.parse(JSON.stringify({ clips: app.clips, playlists: app.playlists, games: app.games, teams: app.teams }));
    const { store } = storage(entries);
    assert.deepEqual(shape(readLegacy(store).lib), shape(classic));
  });

  test(`reading a ${name} library changes no key and only ever reads`, () => {
    const s = storage(entries);
    const before = s.snapshot();
    readLegacy(s.store);
    readLegacy(s.store);
    assert.equal(s.snapshot(), before, 'every filmroom_ key byte-identical');
    assert.deepEqual([...s.calls], ['getItem'], 'getItem is the only method touched');
  });
}

test('a corrupt clips key costs the clips and nothing else, and leaves no _corrupt twin', () => {
  const s = storage({ ...shapes['current (teams, games, playlists)'], filmroom_clips: '[{not json' });
  const r = readLegacy(s.store);
  assert.deepEqual(r.damaged, ['clips']);
  assert.equal(r.lib.clips.length, 0);
  assert.equal(r.lib.games.length, 2);
  assert.equal(r.lib.teams.length, 2);
  assert.equal(r.lib.playlists.length, 2);
  assert.equal(s.map.has('filmroom_clips_corrupt'), false);
  assert.equal(s.map.get('filmroom_clips'), '[{not json', 'the unreadable value is left exactly as it was');
});

test('valid JSON of the wrong shape counts as damaged, as in classic Angl', () => {
  assert.deepEqual(readLegacy(storage({ filmroom_games: '{"not":"a list"}' }).store).damaged, ['games']);
});

test('an empty browser has no classic library', () => {
  const r = readLegacy(storage({}).store);
  assert.equal(r.present, false);
  assert.deepEqual(r.lib, { clips: [], playlists: [], games: [], teams: [] });
});

test('the extras come across untouched, the API key included (it stays on this device)', () => {
  const r = readLegacy(storage(shapes['current (teams, games, playlists)']!).store);
  assert.equal(r.extras.hotkey, 'AltRight');
  assert.equal(r.extras.dictationLog.length, 1);
  assert.deepEqual(r.extras.settings, { parser: 'builtin', apiKey: '' });
});

test('reading the same library twice gives the same ids, pre-games library included', async () => {
  for (const entries of Object.values(shapes)) {
    const a = await legacyToV5(readLegacy(storage(entries).store).lib);
    const b = await legacyToV5(readLegacy(storage(entries).store).lib);
    assert.deepEqual([a.teams, a.films, a.clips].map(l => l.map(x => x.id)), [b.teams, b.films, b.clips].map(l => l.map(x => x.id)));
  }
});

test('a second read adds nothing; one more clip in classic Angl adds exactly that clip', async () => {
  const entries = shapes['current (teams, games, playlists)']!;
  const first = await legacyToV5(readLegacy(storage(entries).store).lib);
  const have = { teams: new Set(first.teams.map(t => t.id)), films: new Set(first.films.map(f => f.id)), clips: new Set(first.clips.map(c => c.id)) };
  assert.deepEqual(newItems(have, await legacyToV5(readLegacy(storage(entries).store).lib)), { teams: [], films: [], clips: [] });

  const more = { ...entries, filmroom_clips: [...(entries.filmroom_clips as object[]), { id: 'c3', label: 'New one', videoId: 'bJJy8l6tVAI', gameId: 'g1', playlistId: 'p1', start: 50, end: 55, effStart: 48, effEnd: 57 }] };
  const added = newItems(have, await legacyToV5(readLegacy(storage(more).store).lib));
  assert.deepEqual(added.clips.map(c => c.title), ['New one']);
  assert.equal(added.films.length + added.teams.length, 0);
});

test('the fingerprint follows the library, not what was last opened', async () => {
  const entries = shapes['current (teams, games, playlists)']!;
  const fp = (e: Record<string, unknown>) => fingerprint(readLegacy(storage(e).store).fingerprintSource);
  const base = await fp(entries);
  assert.equal(await fp({ ...entries, filmroom_active_game: 'g2', filmroom_hotkey: 'F13' }), base);
  assert.notEqual(await fp({ ...entries, filmroom_clips: [] }), base);
});

test('converted clips keep their film, category, order and played range', async () => {
  const v5 = await legacyToV5(readLegacy(storage(shapes['current (teams, games, playlists)']!).store).lib);
  const [a, b] = v5.clips;
  const film = v5.films.find(f => f.id === a?.filmId);
  assert.equal(film?.title, 'Round 7');
  assert.equal(v5.teams.find(t => t.id === film?.teamId)?.name, 'U16 Boys');
  assert.deepEqual(film?.categories, [{ name: 'Defence', emoji: '🛡️' }]);
  assert.equal(a?.category, 'Defence');
  assert.deepEqual([a?.startSeconds, a?.endSeconds, a?.markedStartSeconds], [0, 4, 1]);
  assert.ok(a && b && a.createdAt < b.createdAt, 'classic order survives as creation time');
  assert.equal(a?.visibility, 'private');
});

test('two pre-games libraries from different machines don’t share film ids', async () => {
  const one = await legacyToV5(readLegacy(storage(shapes['pre-games (flat playlists, one video key)']!).store).lib);
  const other = await legacyToV5(readLegacy(storage({ ...shapes['pre-games (flat playlists, one video key)'], filmroom_video: 'dQw4w9WgXcQ' }).store).lib);
  assert.notEqual(one.films[0]?.id, other.films[0]?.id);
});
