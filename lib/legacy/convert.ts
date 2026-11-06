/*
 * A migrated classic library → the clips Angl's database stores (PLAN.md §3).
 * Pure and synchronous: the browser runs it to show what a file contains, and
 * the server runs it again on what it is sent rather than trusting the browser.
 */
import { isVideoId } from '../youtube.ts';
import type { LegacyLibrary } from './types.ts';

export interface ImportedClip {
  legacyId: string;
  title: string;
  videoId: string | null;       // null: the clip can be stored but never published
  startSeconds: number;         // the range classic Angl played (effStart/effEnd)
  endSeconds: number;
  markedStartSeconds: number | null;
  markedEndSeconds: number | null;
  category: string | null;      // the classic playlist's name
  legacy: {
    id: string;
    index: number;              // position in the classic library: its only record of order
    gameId: string | null;
    playlistId: string | null;
    gameTitle: string | null;
    teamName: string | null;
    sport: string | null;
    categoryEmoji: string | null;
  };
}

export interface SkippedClip { index: number; label: string; reason: string }

export interface Conversion { clips: ImportedClip[]; skipped: SkippedClip[] }

const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
// numeric(9,2) in Postgres; rounding here keeps the stored value and the id in step
const cents = (n: number) => Math.round(n * 100) / 100;

export function convertLibrary(lib: LegacyLibrary): Conversion {
  const clips: ImportedClip[] = [];
  const skipped: SkippedClip[] = [];
  const seen = new Set<string>();

  lib.clips.forEach((c, index) => {
    const label = typeof c.label === 'string' ? c.label.trim() : '';
    const skip = (reason: string) => skipped.push({ index, label: label || `Clip ${index + 1}`, reason });

    const legacyId = typeof c.id === 'string' && c.id ? c.id : null;
    if (!legacyId) return skip('it has no id');
    if (seen.has(legacyId)) return skip('another clip in the file has the same id');

    const game = lib.games.find(g => g.id === c.gameId) ?? null;
    const team = game ? lib.teams.find(t => t.id === game.teamId) ?? null : null;
    const pl = lib.playlists.find(p => p.id === c.playlistId) ?? null;

    // The played range. A clip saved before effStart/effEnd existed is worked
    // out from its marks and buffers, the way classic Angl computes them.
    const start = finite(c.start), end = finite(c.end);
    const before = finite(c.bufBefore) ?? 0, after = finite(c.bufAfter) ?? 0;
    const effStart = finite(c.effStart) ?? (start !== null ? Math.max(0, start - before) : null);
    const effEnd = finite(c.effEnd) ?? (end !== null ? end + after : null);
    if (effStart === null || effEnd === null) return skip('it has no start or end time');
    if (effStart < 0 || effEnd <= effStart) return skip('its end is not after its start');

    const rawVideo = c.videoId || game?.videoId || null;
    seen.add(legacyId);
    clips.push({
      legacyId,
      title: (label || `Clip ${index + 1}`).slice(0, 200),
      videoId: isVideoId(rawVideo) ? rawVideo : null,
      startSeconds: cents(effStart),
      endSeconds: cents(effEnd),
      markedStartSeconds: start !== null ? cents(start) : null,
      markedEndSeconds: end !== null ? cents(end) : null,
      category: pl?.name ?? null,
      legacy: {
        id: legacyId,
        index,
        gameId: game?.id ?? null,
        playlistId: pl?.id ?? null,
        gameTitle: game?.title ?? null,
        teamName: team?.name ?? null,
        sport: team ? (team.sport || 'basketball') : null,
        categoryEmoji: pl?.emoji ?? null,
      },
    });
  });
  return { clips, skipped };
}

export interface Group { team: string; films: { key: string; film: string; categories: { category: string; count: number }[]; count: number }[]; count: number }

/* team → film → category, in library order, with counts: what the import
 * preview shows so it can be checked against classic Angl's dashboard. */
export function groupClips(clips: Pick<ImportedClip, 'category' | 'legacy'>[]): Group[] {
  const teams: Group[] = [];
  for (const c of clips) {
    const tName = c.legacy.teamName ?? 'No team';
    const fName = c.legacy.gameTitle ?? 'No film';
    // By id, not title: two films can share a name ("Untitled film")
    const fKey = c.legacy.gameId ?? '';
    const cName = c.category ?? 'No category';
    let t = teams.find(x => x.team === tName);
    if (!t) teams.push(t = { team: tName, films: [], count: 0 });
    let f = t.films.find(x => x.key === fKey);
    if (!f) t.films.push(f = { key: fKey, film: fName, categories: [], count: 0 });
    let k = f.categories.find(x => x.category === cName);
    if (!k) f.categories.push(k = { category: cName, count: 0 });
    t.count++; f.count++; k.count++;
  }
  return teams;
}
