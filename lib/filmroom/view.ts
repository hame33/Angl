/*
 * What the film room shows: which clips are in view, the cross-film category
 * rollup, the dashboard numbers, and stepping through a list. Pure, tested in
 * node. Classic names noted where there is one.
 */
import type { Clip, Film, LocalLibrary } from '../model/types.ts';

/* What the clip list is showing: one film (all of it, or one category), or a
 * category rolled up across every film of a team (classic openCategory). */
export type Selection =
  | { kind: 'film'; filmId: string; category: string | null }
  | { kind: 'category'; name: string; teamId: string | null };

const byCreated = <T extends { createdAt: string }>(a: T, b: T) => a.createdAt.localeCompare(b.createdAt) || 0;

/* scopedGames: a team's films, or every film for "All teams" (null) */
export function teamFilms(lib: LocalLibrary, teamId: string | null): Film[] {
  return lib.films.filter(f => teamId === null || f.teamId === teamId).sort(byCreated);
}

export function filmClips(lib: LocalLibrary, filmId: string): Clip[] {
  return lib.clips.filter(c => c.filmId === filmId).sort(byCreated);
}

/* visibleClips. A category view keeps film order, then clip order, so play-all
 * runs through a season game by game. */
export function visibleClips(lib: LocalLibrary, sel: Selection): Clip[] {
  if (sel.kind === 'film') return filmClips(lib, sel.filmId).filter(c => sel.category === null || c.category === sel.category);
  const films = teamFilms(lib, sel.teamId);
  return films.flatMap(f => filmClips(lib, f.id).filter(c => c.category === sel.name));
}

export const clipSeconds = (c: Clip) => Math.max(0, c.endSeconds - c.startSeconds);

/* categoryRollup: categories sharing a name across films are one; empty ones
 * still show, most clips first. */
export function categoryRollup(lib: LocalLibrary, teamId: string | null) {
  const map = new Map<string, { name: string; emoji: string; count: number; seconds: number; films: Set<string> }>();
  const films = teamFilms(lib, teamId);
  for (const f of films) for (const k of f.categories) {
    if (!map.has(k.name)) map.set(k.name, { name: k.name, emoji: k.emoji, count: 0, seconds: 0, films: new Set() });
    map.get(k.name)!.films.add(f.id);
  }
  const ids = new Set(films.map(f => f.id));
  for (const c of lib.clips) {
    if (!c.filmId || !ids.has(c.filmId) || !c.category) continue;
    if (!map.has(c.category)) map.set(c.category, { name: c.category, emoji: '', count: 0, seconds: 0, films: new Set() });
    const e = map.get(c.category)!;
    e.count++; e.seconds += clipSeconds(c); e.films.add(c.filmId);
  }
  return [...map.values()].map(e => ({ ...e, films: e.films.size }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function stats(lib: LocalLibrary, teamId: string | null) {
  const films = teamFilms(lib, teamId);
  const ids = new Set(films.map(f => f.id));
  const clips = lib.clips.filter(c => c.filmId && ids.has(c.filmId));
  return {
    films: films.length,
    clips: clips.length,
    categories: new Set(films.flatMap(f => f.categories.map(k => k.name))).size,
    seconds: clips.reduce((n, c) => n + clipSeconds(c), 0),
  };
}

export function recentClips(lib: LocalLibrary, teamId: string | null, n = 9): Clip[] {
  const ids = new Set(teamFilms(lib, teamId).map(f => f.id));
  return lib.clips.filter(c => c.filmId && ids.has(c.filmId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, n);
}

/* prevClip / nextClip wrap around the ends of the list */
export function step(length: number, index: number, dir: 1 | -1): number {
  if (!length) return -1;
  if (index < 0) return dir === 1 ? 0 : length - 1;
  return (index + dir + length) % length;
}

/* fmtDuration: 45s, 3m 05s, 1h 02m */
export function fmtDuration(total: number): string {
  const t = Math.round(total);
  if (t < 60) return `${t}s`;
  const m = Math.floor(t / 60), s = t % 60;
  if (m < 60) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}
