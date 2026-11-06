/*
 * Everything the film room can do to a library, as pure functions. Each one
 * takes the library and returns a change set — what to save, what to delete —
 * which the page applies to its state and to IndexedDB in one go. Nothing here
 * touches the browser, so all of it is tested in node (ops.test.ts).
 *
 * The behaviours follow classic Angl's index.html, function by function; the
 * classic name is noted where there is one. docs/film-room-parity.md lists them.
 */
import type { Clip, Film, LocalLibrary, Team } from '../model/types.ts';
import { DEFAULT_SPORT, sport } from './sports.ts';

export interface Changes {
  put: { teams?: Team[]; films?: Film[]; clips?: Clip[] };
  remove: { teams?: string[]; films?: string[]; clips?: string[] };
}
export class OpError extends Error {}

export interface Ctx { now: string; newId: () => string }
export const realCtx = (): Ctx => ({ now: new Date().toISOString(), newId: () => crypto.randomUUID() });

const none: Changes = { put: {}, remove: {} };
const cents = (n: number) => Math.round(n * 100) / 100;

/* Apply a change set to an in-memory library (the page's state). */
export function apply(lib: LocalLibrary, ch: Changes): LocalLibrary {
  const merge = <T extends { id: string }>(list: T[], put: T[] = [], remove: string[] = []) => {
    const gone = new Set(remove);
    const byId = new Map(put.map(x => [x.id, x]));
    const kept = list.filter(x => !gone.has(x.id)).map(x => byId.get(x.id) ?? x);
    const fresh = put.filter(x => !list.some(y => y.id === x.id) && !gone.has(x.id));
    return [...kept, ...fresh];
  };
  return {
    teams: merge(lib.teams, ch.put.teams, ch.remove.teams),
    films: merge(lib.films, ch.put.films, ch.remove.films),
    clips: merge(lib.clips, ch.put.clips, ch.remove.clips),
  };
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const teamOf = (lib: LocalLibrary, film: Film | undefined) => (film ? lib.teams.find(t => t.id === film.teamId) : undefined);

/* ── Teams ────────────────────────────────────────────────────────────────── */

/* createTeam: names are unique, ignoring case */
export function createTeam(lib: LocalLibrary, name: string, sportId: string, ctx: Ctx): { changes: Changes; team: Team } {
  const n = name.trim();
  if (!n) throw new OpError('Enter a team name');
  if (lib.teams.some(t => sameName(t.name, n))) throw new OpError(`"${n}" already exists`);
  const team: Team = { id: ctx.newId(), ownerId: null, name: n.slice(0, 80), sport: sport(sportId).id, createdAt: ctx.now, updatedAt: ctx.now, legacyId: null };
  return { changes: { put: { teams: [team] }, remove: {} }, team };
}

export function renameTeam(lib: LocalLibrary, teamId: string, name: string, ctx: Ctx): Changes {
  const t = lib.teams.find(x => x.id === teamId);
  const n = name.trim();
  if (!t) throw new OpError('That team no longer exists');
  if (!n) throw new OpError('Enter a name');
  return { put: { teams: [{ ...t, name: n.slice(0, 80), updatedAt: ctx.now }] }, remove: {} };
}

/* setTeamSport: only what happens from here on — existing categories stay */
export function setTeamSport(lib: LocalLibrary, teamId: string, sportId: string, ctx: Ctx): Changes {
  const t = lib.teams.find(x => x.id === teamId);
  if (!t) throw new OpError('That team no longer exists');
  return { put: { teams: [{ ...t, sport: sport(sportId).id, updatedAt: ctx.now }] }, remove: {} };
}

/* deleteTeam: its films and their clips go with it */
export function deleteTeam(lib: LocalLibrary, teamId: string): Changes {
  const films = lib.films.filter(f => f.teamId === teamId).map(f => f.id);
  const filmSet = new Set(films);
  return { put: {}, remove: { teams: [teamId], films, clips: lib.clips.filter(c => c.filmId && filmSet.has(c.filmId)).map(c => c.id) } };
}

/* ── Films (classic: games) ───────────────────────────────────────────────── */

/*
 * createGame. A film needs a team, so the first one makes "My team". Pasting a
 * film the team already has opens that one rather than duplicating it (two
 * teams can each have their own copy of the same film). A new film inherits
 * the team's previous film's categories, so a season keeps one vocabulary;
 * the team's sport supplies them otherwise.
 */
export function createFilm(lib: LocalLibrary, input: { videoId: string; title: string; teamId: string | null }, ctx: Ctx): { changes: Changes; film: Film; existing: boolean } {
  const changes: Changes = { put: {}, remove: {} };
  let team = lib.teams.find(t => t.id === input.teamId) ?? lib.teams[0];
  if (!team) {
    team = { id: ctx.newId(), ownerId: null, name: 'My team', sport: DEFAULT_SPORT, createdAt: ctx.now, updatedAt: ctx.now, legacyId: null };
    changes.put.teams = [team];
  }
  const existing = lib.films.find(f => f.teamId === team.id && f.video.videoId === input.videoId);
  if (existing) return { changes, film: existing, existing: true };

  const previous = lib.films.filter(f => f.teamId === team.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
  const categories = previous?.categories.length ? previous.categories.map(c => ({ ...c })) : sport(team.sport).categories.map(c => ({ ...c }));
  const typed = input.title.trim();
  const film: Film = {
    id: ctx.newId(), ownerId: null, teamId: team.id,
    title: (typed || 'Untitled film').slice(0, 300),
    video: { provider: 'youtube', videoId: input.videoId },
    categories, autoTitle: !typed,
    createdAt: ctx.now, updatedAt: ctx.now, legacyId: null,
  };
  changes.put.films = [film];
  return { changes, film, existing: false };
}

/* A typed title outranks whatever YouTube would have supplied (confirmRename) */
export function renameFilm(lib: LocalLibrary, filmId: string, title: string, ctx: Ctx): Changes {
  const f = lib.films.find(x => x.id === filmId);
  const t = title.trim();
  if (!f) throw new OpError('That film no longer exists');
  if (!t) throw new OpError('Enter a title');
  return { put: { films: [{ ...f, title: t.slice(0, 300), autoTitle: false, updatedAt: ctx.now }] }, remove: {} };
}

/* tryAutoTitle: the player knows the video's real title; use it once */
export function autoTitleFilm(lib: LocalLibrary, filmId: string, title: string, ctx: Ctx): Changes {
  const f = lib.films.find(x => x.id === filmId);
  if (!f || !f.autoTitle || !title.trim()) return none;
  return { put: { films: [{ ...f, title: title.trim().slice(0, 300), autoTitle: false, updatedAt: ctx.now }] }, remove: {} };
}

/* deleteGame: its clips go with it */
export function deleteFilm(lib: LocalLibrary, filmId: string): Changes {
  return { put: {}, remove: { films: [filmId], clips: lib.clips.filter(c => c.filmId === filmId).map(c => c.id) } };
}

/* ── Categories (classic: playlists, one set per film) ────────────────────── */

export function addCategory(lib: LocalLibrary, filmId: string, name: string, emoji: string, ctx: Ctx): Changes {
  const f = lib.films.find(x => x.id === filmId);
  const n = name.trim().slice(0, 40);
  if (!f) throw new OpError('Open a film first — categories belong to a film');
  if (!n) throw new OpError('Enter a category name');
  if (f.categories.some(c => sameName(c.name, n))) throw new OpError(`"${n}" already exists in this film`);
  return { put: { films: [{ ...f, categories: [...f.categories, { name: n, emoji }], updatedAt: ctx.now }] }, remove: {} };
}

/* Renaming carries the film's clips with it */
export function renameCategory(lib: LocalLibrary, filmId: string, from: string, to: string, ctx: Ctx): Changes {
  const f = lib.films.find(x => x.id === filmId);
  const n = to.trim().slice(0, 40);
  if (!f) throw new OpError('That film no longer exists');
  if (!n) throw new OpError('Enter a name');
  if (from !== n && f.categories.some(c => sameName(c.name, n))) throw new OpError(`"${n}" already exists in this film`);
  return {
    put: {
      films: [{ ...f, categories: f.categories.map(c => (c.name === from ? { ...c, name: n } : c)), updatedAt: ctx.now }],
      clips: lib.clips.filter(c => c.filmId === filmId && c.category === from).map(c => ({ ...c, category: n, updatedAt: ctx.now })),
    },
    remove: {},
  };
}

/* deletePlaylist: the clips stay in their own film — moved to General there,
 * or the first other category, or a General made for them. */
export function deleteCategory(lib: LocalLibrary, filmId: string, name: string, ctx: Ctx): Changes {
  const f = lib.films.find(x => x.id === filmId);
  if (!f) throw new OpError('That film no longer exists');
  let categories = f.categories.filter(c => c.name !== name);
  const held = lib.clips.filter(c => c.filmId === filmId && c.category === name);
  let home = categories.find(c => c.name === 'General') ?? categories[0];
  if (!home && held.length) {
    home = { ...sport(teamOf(lib, f)?.sport).fallbackCategory };
    categories = [home];
  }
  return {
    put: {
      films: [{ ...f, categories, updatedAt: ctx.now }],
      clips: home ? held.map(c => ({ ...c, category: home!.name, updatedAt: ctx.now })) : [],
    },
    remove: {},
  };
}

/* ── Clips ────────────────────────────────────────────────────────────────── */

export interface ClipInput {
  filmId: string;
  start: number;            // the marked moment
  end: number | null;       // null: a default length (Phase 6 learns it, as classic does)
  bufBefore: number;
  bufAfter: number;
  title: string;
  category: string | null;
}
export const DEFAULT_CLIP_SECONDS = 5;

/*
 * addClip. The played range is the marks plus the buffers, never below 0.
 * Every clip needs a home: a category the film doesn't have falls back to its
 * first, or to the sport's fallback made for it.
 */
export function addClip(lib: LocalLibrary, input: ClipInput, ctx: Ctx): { changes: Changes; clip: Clip } {
  const film = lib.films.find(f => f.id === input.filmId);
  if (!film) throw new OpError('This film has no game — open one from the library');
  if (!film.video.videoId) throw new OpError('Load a film first — clips need a source video');
  if (!Number.isFinite(input.start) || input.start < 0) throw new OpError('Enter a start time');
  const end = input.end ?? input.start + DEFAULT_CLIP_SECONDS;
  if (!(end > input.start)) throw new OpError('End must be after start');
  if (end - input.start > 600) throw new OpError('A clip can be at most 10 minutes');
  const before = Math.min(15, Math.max(0, input.bufBefore)), after = Math.min(15, Math.max(0, input.bufAfter));

  const changes: Changes = { put: {}, remove: {} };
  let category = input.category && film.categories.some(c => c.name === input.category) ? input.category : null;
  if (!category) {
    if (film.categories[0]) category = film.categories[0].name;
    else {
      const home = sport(teamOf(lib, film)?.sport).fallbackCategory;
      category = home.name;
      changes.put.films = [{ ...film, categories: [{ ...home }], updatedAt: ctx.now }];
    }
  }
  const count = lib.clips.filter(c => c.filmId === film.id).length;
  const clip: Clip = {
    kind: 'clip', id: ctx.newId(), ownerId: null, shareId: null, visibility: 'private',
    title: (input.title.trim() || `Clip ${count + 1}`).slice(0, 200), tags: [], createdVia: 'manual',
    createdAt: ctx.now, updatedAt: ctx.now, publishedAt: null,
    video: { provider: 'youtube', videoId: film.video.videoId },
    startSeconds: cents(Math.max(0, input.start - before)), endSeconds: cents(end + after),
    markedStartSeconds: cents(input.start), markedEndSeconds: cents(end),
    notes: '', coachingPoints: [],
    credit: { coachName: null, url: null, sourceTitle: null, channelName: null, channelUrl: null },
    thumbnailUrl: null, filmId: film.id, category, legacy: null,
  };
  changes.put.clips = [clip];
  return { changes, clip };
}

/* The buffers a clip was cut with: marks minus the played range. */
export function buffers(c: Clip): { before: number; after: number } {
  return {
    before: c.markedStartSeconds === null ? 0 : cents(Math.max(0, c.markedStartSeconds - c.startSeconds)),
    after: c.markedEndSeconds === null ? 0 : cents(Math.max(0, c.endSeconds - c.markedEndSeconds)),
  };
}

export interface ClipPatch {
  title?: string;
  start?: number; end?: number; bufBefore?: number; bufAfter?: number;
  category?: string;
  notes?: string; coachingPoints?: string[]; tags?: string[];
  credit?: Partial<Clip['credit']>;
}

/* Editing a clip: new fields (notes, tags, credit) and its times; moving it
 * only between its own film's categories (confirmMove). */
export function updateClip(lib: LocalLibrary, clipId: string, patch: ClipPatch, ctx: Ctx): Changes {
  const c = lib.clips.find(x => x.id === clipId);
  if (!c) throw new OpError('That clip no longer exists');
  const film = lib.films.find(f => f.id === c.filmId);
  const buf = buffers(c);
  const start = patch.start ?? c.markedStartSeconds ?? c.startSeconds;
  const end = patch.end ?? c.markedEndSeconds ?? c.endSeconds;
  const before = Math.min(15, Math.max(0, patch.bufBefore ?? buf.before));
  const after = Math.min(15, Math.max(0, patch.bufAfter ?? buf.after));
  if (!(end > start)) throw new OpError('End must be after start');
  if (end - start > 600) throw new OpError('A clip can be at most 10 minutes');
  if (patch.category !== undefined && film && !film.categories.some(k => k.name === patch.category)) {
    throw new OpError('Pick a category from this clip’s own film');
  }
  const title = patch.title !== undefined ? patch.title.trim() : c.title;
  if (!title) throw new OpError('A clip needs a title');
  const next: Clip = {
    ...c,
    title: title.slice(0, 200),
    startSeconds: cents(Math.max(0, start - before)), endSeconds: cents(end + after),
    markedStartSeconds: cents(start), markedEndSeconds: cents(end),
    category: patch.category ?? c.category,
    notes: patch.notes !== undefined ? patch.notes.replace(/\r\n/g, '\n').trim().slice(0, 20000) : c.notes,
    coachingPoints: patch.coachingPoints ?? c.coachingPoints,
    tags: patch.tags ?? c.tags,
    credit: { ...c.credit, ...patch.credit },
    updatedAt: ctx.now,
  };
  return { put: { clips: [next] }, remove: {} };
}

export function deleteClips(ids: string[]): Changes {
  return { put: {}, remove: { clips: ids } };
}
