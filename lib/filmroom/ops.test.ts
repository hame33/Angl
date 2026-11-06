import test from 'node:test';
import assert from 'node:assert/strict';
import type { LocalLibrary } from '../model/types.ts';
import {
  addCategory, addClip, apply, autoTitleFilm, buffers, createFilm, createTeam, deleteCategory, deleteClips,
  deleteFilm, deleteTeam, OpError, renameCategory, renameFilm, setTeamSport, updateClip, type Changes, type Ctx,
} from './ops.ts';
import { categoryRollup, fmtDuration, recentClips, stats, step, visibleClips } from './view.ts';

/* A clock that moves on a second per call, and ids in order, so results are exact */
function ctx(): Ctx {
  let t = Date.parse('2026-11-06T00:00:00Z'), n = 0;
  return {
    get now() { t += 1000; return new Date(t).toISOString(); },
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  };
}
const EMPTY: LocalLibrary = { teams: [], films: [], clips: [] };
const run = (lib: LocalLibrary, ch: Changes) => apply(lib, ch);

function season() {
  const c = ctx();
  let lib = EMPTY;
  const { changes: t1, team } = createTeam(lib, 'U16 Boys', 'basketball', c); lib = run(lib, t1);
  const { changes: f1, film: r7 } = createFilm(lib, { videoId: 'bJJy8l6tVAI', title: 'Round 7', teamId: team.id }, c); lib = run(lib, f1);
  const { changes: f2, film: r8 } = createFilm(lib, { videoId: 'dQw4w9WgXcQ', title: '', teamId: team.id }, c); lib = run(lib, f2);
  return { c, lib, team, r7, r8 };
}

test('a team name is required and unique, ignoring case', () => {
  const c = ctx();
  const { changes } = createTeam(EMPTY, 'U16 Boys', 'netball', c);
  const lib = apply(EMPTY, changes);
  assert.equal(lib.teams[0]?.sport, 'netball');
  assert.throws(() => createTeam(lib, 'u16 boys', 'basketball', c), OpError);
  assert.throws(() => createTeam(lib, '  ', 'basketball', c), OpError);
});

test('the first film makes "My team"; a new film starts with the sport’s categories', () => {
  const c = ctx();
  const { changes, film } = createFilm(EMPTY, { videoId: 'bJJy8l6tVAI', title: '', teamId: null }, c);
  const lib = apply(EMPTY, changes);
  assert.equal(lib.teams[0]?.name, 'My team');
  assert.deepEqual(film.categories.map(k => k.name), ['Offence', 'Defence', 'Highlights']);
  assert.equal(film.title, 'Untitled film');
  assert.equal(film.autoTitle, true);
});

test('a team’s next film inherits the previous film’s categories, not the defaults', () => {
  const { c, lib, team, r7 } = season();
  const withCat = run(lib, addCategory(lib, r7.id, 'Press break', '🎯', c));
  // the newest film decides, so add to Round 8 and check a third film copies it
  const r8 = withCat.films.find(f => f.title === 'Untitled film')!;
  const lib2 = run(withCat, addCategory(withCat, r8.id, 'Transition', '⚡', c));
  const { film } = createFilm(lib2, { videoId: 'aaaaaaaaaaa', title: 'Round 9', teamId: team.id }, c);
  assert.deepEqual(film.categories.map(k => k.name), ['Offence', 'Defence', 'Highlights', 'Transition']);
});

test('pasting a film the team already has opens it rather than duplicating it', () => {
  const { c, lib, team, r7 } = season();
  const again = createFilm(lib, { videoId: 'bJJy8l6tVAI', title: 'Again', teamId: team.id }, c);
  assert.equal(again.existing, true);
  assert.equal(again.film.id, r7.id);
  // …but another team can have its own copy
  const { changes, team: other } = createTeam(lib, 'U14 Girls', 'netball', c);
  const lib2 = run(lib, changes);
  const theirs = createFilm(lib2, { videoId: 'bJJy8l6tVAI', title: 'Round 7', teamId: other.id }, c);
  assert.equal(theirs.existing, false);
  assert.deepEqual(theirs.film.categories.map(k => k.name), ['Attack', 'Defence', 'Highlights'], 'netball defaults');
});

test('the player’s title fills an untitled film once; a typed title is never replaced', () => {
  const { c, lib, r7, r8 } = season();
  const lib2 = run(lib, autoTitleFilm(lib, r8.id, 'Arkansas practice', c));
  assert.equal(lib2.films.find(f => f.id === r8.id)?.title, 'Arkansas practice');
  assert.equal(lib2.films.find(f => f.id === r8.id)?.autoTitle, false);
  assert.deepEqual(autoTitleFilm(lib2, r7.id, 'Something else', c), { put: {}, remove: {} });
  const renamed = run(lib2, renameFilm(lib2, r8.id, 'Round 8', c));
  assert.deepEqual(autoTitleFilm(renamed, r8.id, 'Arkansas practice', c), { put: {}, remove: {} });
});

test('a clip plays its marks plus buffers, never before 0:00, and keeps its marks', () => {
  const { c, lib, r7 } = season();
  const { clip } = addClip(lib, { filmId: r7.id, start: 1, end: 9, bufBefore: 2, bufAfter: 3, title: 'Closeout', category: 'Defence' }, c);
  assert.deepEqual([clip.startSeconds, clip.endSeconds, clip.markedStartSeconds, clip.markedEndSeconds], [0, 12, 1, 9]);
  assert.deepEqual(buffers(clip), { before: 1, after: 3 }, 'the before-buffer was cut short by the start of the film');
  assert.equal(clip.category, 'Defence');
});

test('a clip with no end gets the default length; an end before the start is refused', () => {
  const { c, lib, r7 } = season();
  const { clip } = addClip(lib, { filmId: r7.id, start: 100, end: null, bufBefore: 0, bufAfter: 0, title: '', category: null }, c);
  assert.equal(clip.endSeconds, 105);
  assert.equal(clip.title, 'Clip 1');
  assert.equal(clip.category, 'Offence', 'no category chosen: the film’s first');
  assert.throws(() => addClip(lib, { filmId: r7.id, start: 10, end: 5, bufBefore: 0, bufAfter: 0, title: '', category: null }, c), /End must be after start/);
});

test('a film with every category deleted still gives a new clip a home', () => {
  const { c, lib, r7 } = season();
  let l = lib;
  for (const name of ['Offence', 'Defence', 'Highlights']) l = run(l, deleteCategory(l, r7.id, name, c));
  assert.deepEqual(l.films.find(f => f.id === r7.id)?.categories, []);
  const { changes, clip } = addClip(l, { filmId: r7.id, start: 1, end: 2, bufBefore: 0, bufAfter: 0, title: 'x', category: 'Defence' }, c);
  assert.equal(clip.category, 'General');
  assert.deepEqual(changes.put.films?.[0]?.categories, [{ name: 'General', emoji: '🏀' }]);
});

test('deleting a category moves its clips to General in the same film, made if needed', () => {
  const { c, lib, r7, r8 } = season();
  let l = lib;
  l = run(l, addClip(l, { filmId: r7.id, start: 1, end: 2, bufBefore: 0, bufAfter: 0, title: 'r7', category: 'Defence' }, c).changes);
  l = run(l, addClip(l, { filmId: r8.id, start: 1, end: 2, bufBefore: 0, bufAfter: 0, title: 'r8', category: 'Defence' }, c).changes);
  l = run(l, deleteCategory(l, r7.id, 'Defence', c));
  assert.equal(l.clips.find(x => x.title === 'r7')?.category, 'Offence', 'no General in the film: the first remaining');
  assert.equal(l.clips.find(x => x.title === 'r8')?.category, 'Defence', 'another film’s Defence is untouched');
  l = run(l, addCategory(l, r8.id, 'General', '🏀', c));
  l = run(l, deleteCategory(l, r8.id, 'Defence', c));
  assert.equal(l.clips.find(x => x.title === 'r8')?.category, 'General');
});

test('renaming a category carries its clips; names stay unique within a film', () => {
  const { c, lib, r7 } = season();
  let l = run(lib, addClip(lib, { filmId: r7.id, start: 1, end: 2, bufBefore: 0, bufAfter: 0, title: 'x', category: 'Defence' }, c).changes);
  l = run(l, renameCategory(l, r7.id, 'Defence', 'D', c));
  assert.equal(l.clips[0]?.category, 'D');
  assert.throws(() => renameCategory(l, r7.id, 'D', 'offence', c), /already exists/);
  assert.throws(() => addCategory(l, r7.id, 'OFFENCE', '⚡', c), /already exists/);
});

test('editing a clip: notes, tags, credit, times and buffers; moves stay inside its film', () => {
  const { c, lib, r7 } = season();
  const { changes, clip } = addClip(lib, { filmId: r7.id, start: 10, end: 20, bufBefore: 2, bufAfter: 2, title: 'x', category: 'Defence' }, c);
  let l = run(lib, changes);
  l = run(l, updateClip(l, clip.id, { notes: 'High hands.\r\n', tags: ['closeouts'], credit: { coachName: 'Coach X' }, end: 25, bufAfter: 0, category: 'Offence' }, c));
  const e = l.clips[0]!;
  assert.deepEqual([e.notes, e.tags, e.credit.coachName, e.category], ['High hands.', ['closeouts'], 'Coach X', 'Offence']);
  assert.deepEqual([e.startSeconds, e.endSeconds, e.markedEndSeconds], [8, 25, 25], 'the old before-buffer is kept');
  assert.throws(() => updateClip(l, clip.id, { category: 'Not in this film' }, c), /own film/);
  assert.throws(() => updateClip(l, clip.id, { title: '  ' }, c), /needs a title/);
  assert.throws(() => updateClip(l, clip.id, { start: 30 }, c), /End must be after start/);
});

test('deleting a team takes its films and clips; deleting a film takes its clips', () => {
  const { c, lib, team, r7, r8 } = season();
  let l = run(lib, addClip(lib, { filmId: r7.id, start: 1, end: 2, bufBefore: 0, bufAfter: 0, title: 'a', category: null }, c).changes);
  l = run(l, addClip(l, { filmId: r8.id, start: 1, end: 2, bufBefore: 0, bufAfter: 0, title: 'b', category: null }, c).changes);
  const afterFilm = run(l, deleteFilm(l, r7.id));
  assert.deepEqual([afterFilm.films.length, afterFilm.clips.map(x => x.title)], [1, ['b']]);
  const afterTeam = run(l, deleteTeam(l, team.id));
  assert.deepEqual(afterTeam, { teams: [], films: [], clips: [] });
  assert.equal(run(l, deleteClips([l.clips[0]!.id])).clips.length, 1);
});

test('changing a team’s sport changes what comes next, not what is there', () => {
  const { c, lib, team, r7 } = season();
  const l = run(lib, setTeamSport(lib, team.id, 'netball', c));
  assert.deepEqual(l.films.find(f => f.id === r7.id)?.categories.map(k => k.name), ['Offence', 'Defence', 'Highlights']);
});

test('a category view runs film by film, then clip by clip (play-all order)', () => {
  const { c, lib, team, r7, r8 } = season();
  let l = lib;
  const add = (filmId: string, title: string, category: string) => { l = run(l, addClip(l, { filmId, start: 1, end: 2, bufBefore: 0, bufAfter: 0, title, category }, c).changes); };
  add(r8.id, 'r8-a', 'Defence'); add(r7.id, 'r7-a', 'Defence'); add(r7.id, 'r7-b', 'Offence'); add(r7.id, 'r7-c', 'Defence');
  assert.deepEqual(visibleClips(l, { kind: 'category', name: 'Defence', teamId: team.id }).map(x => x.title), ['r7-a', 'r7-c', 'r8-a']);
  assert.deepEqual(visibleClips(l, { kind: 'film', filmId: r7.id, category: null }).map(x => x.title), ['r7-a', 'r7-b', 'r7-c']);
  assert.deepEqual(visibleClips(l, { kind: 'film', filmId: r7.id, category: 'Offence' }).map(x => x.title), ['r7-b']);
  const roll = categoryRollup(l, team.id);
  assert.deepEqual(roll.map(r => [r.name, r.count, r.films]).slice(0, 2), [['Defence', 3, 2], ['Offence', 1, 2]]);
  assert.ok(roll.some(r => r.name === 'Highlights' && r.count === 0), 'empty categories still show');
  assert.deepEqual(stats(l, team.id), { films: 2, clips: 4, categories: 3, seconds: 4 });
  assert.deepEqual(recentClips(l, team.id, 2).map(x => x.title), ['r7-c', 'r7-b']);
});

test('stepping through clips wraps at both ends', () => {
  assert.equal(step(3, 2, 1), 0);
  assert.equal(step(3, 0, -1), 2);
  assert.equal(step(3, -1, 1), 0);
  assert.equal(step(0, 0, 1), -1);
});

test('durations read like classic Angl’s dashboard', () => {
  assert.deepEqual([fmtDuration(45), fmtDuration(185), fmtDuration(3720)], ['45s', '3m 05s', '1h 02m']);
});
