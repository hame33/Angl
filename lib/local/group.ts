/*
 * The local library as the film room lists it: team → film → category →
 * clips, in classic Angl's order. Pure, so it is tested without a browser.
 */
import type { Clip, Film, LocalLibrary, Team } from '../model/types.ts';

export interface FilmGroup { film: Film; categories: { name: string; emoji: string; clips: Clip[] }[]; count: number }
export interface TeamGroup { team: Team | null; films: FilmGroup[]; count: number }

export function groupLibrary(lib: LocalLibrary): TeamGroup[] {
  const clipsByFilm = new Map<string, Clip[]>();
  for (const c of [...lib.clips].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const k = c.filmId ?? '';
    if (!clipsByFilm.has(k)) clipsByFilm.set(k, []);
    clipsByFilm.get(k)!.push(c);
  }
  const filmGroup = (film: Film): FilmGroup => {
    const clips = clipsByFilm.get(film.id) ?? [];
    // The film's own categories first (empty ones included), then any a clip names that the film doesn't
    const names = [...film.categories.map(c => c.name), ...clips.map(c => c.category ?? 'No category')];
    const seen = new Set<string>();
    const categories = names.filter(n => !seen.has(n) && seen.add(n)).map(name => ({
      name,
      emoji: film.categories.find(c => c.name === name)?.emoji ?? '',
      clips: clips.filter(c => (c.category ?? 'No category') === name),
    }));
    return { film, categories, count: clips.length };
  };
  const films = [...lib.films].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const groups: TeamGroup[] = lib.teams.map(team => {
    const fs = films.filter(f => f.teamId === team.id).map(filmGroup);
    return { team, films: fs, count: fs.reduce((n, f) => n + f.count, 0) };
  });
  const orphanFilms = films.filter(f => !f.teamId || !lib.teams.some(t => t.id === f.teamId)).map(filmGroup);
  if (orphanFilms.length) groups.push({ team: null, films: orphanFilms, count: orphanFilms.reduce((n, f) => n + f.count, 0) });
  return groups;
}

export function countLibrary(lib: LocalLibrary) {
  return { teams: lib.teams.length, films: lib.films.length, clips: lib.clips.length };
}
