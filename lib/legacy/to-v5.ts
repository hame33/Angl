/*
 * A migrated classic library → the version 5 model (teams, films, clips),
 * with stable ids, for the browser's local store and the export file.
 *
 * Clip conversion reuses convertLibrary (the same rules the studio import
 * uses), so a clip comes out the same whichever door it came in by.
 */
import type { Clip, Film, LocalLibrary, Team } from '../model/types.ts';
import { isVideoId } from '../youtube.ts';
import { convertLibrary, type SkippedClip } from './convert.ts';
import { legacyLocalId } from './ids.ts';
import type { LegacyLibrary } from './types.ts';

const iso = (ms: unknown, fallback: string) =>
  typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : fallback;

export async function legacyToV5(lib: LegacyLibrary, now = new Date().toISOString()): Promise<LocalLibrary & { skipped: SkippedClip[] }> {
  const teamIds = new Map<string, string>();
  const teams: Team[] = [];
  for (const t of lib.teams) {
    if (!t.id || teamIds.has(t.id)) continue;
    const id = await legacyLocalId.team(t.id, t.name || '');
    teamIds.set(t.id, id);
    const created = iso(t.createdAt, now);
    teams.push({ id, ownerId: null, name: t.name || 'My team', sport: t.sport || 'basketball', createdAt: created, updatedAt: created, legacyId: t.id });
  }

  const filmIds = new Map<string, string>();
  const films: Film[] = [];
  for (const g of lib.games) {
    if (!g.id || filmIds.has(g.id)) continue;
    const id = await legacyLocalId.film(g.id, g.videoId || null);
    filmIds.set(g.id, id);
    const created = iso(g.createdAt, now);
    films.push({
      id, ownerId: null,
      teamId: (g.teamId && teamIds.get(g.teamId)) || null,
      title: g.title || 'Untitled film',
      video: { provider: 'youtube', videoId: isVideoId(g.videoId) ? g.videoId : null },
      // This game's playlists, in classic order: kept even when empty
      categories: lib.playlists.filter(p => p.gameId === g.id).map(p => ({ name: p.name ?? '', emoji: p.emoji ?? '' })),
      createdAt: created, updatedAt: created, legacyId: g.id,
    });
  }

  const { clips: converted, skipped } = convertLibrary(lib);
  const clips: Clip[] = [];
  for (const c of converted) {
    const game = lib.games.find(g => g.id === c.legacy.gameId);
    // Classic clips carry no timestamp; their film's, plus their position, keeps the order
    const base = typeof game?.createdAt === 'number' && game.createdAt > 0 ? game.createdAt : Date.parse(now);
    const created = new Date(base + c.legacy.index).toISOString();
    clips.push({
      kind: 'clip',
      id: await legacyLocalId.clip(c),
      ownerId: null, shareId: null, visibility: 'private',
      title: c.title, tags: [], createdVia: 'import',
      createdAt: created, updatedAt: created, publishedAt: null,
      video: { provider: 'youtube', videoId: c.videoId },
      startSeconds: c.startSeconds, endSeconds: c.endSeconds,
      markedStartSeconds: c.markedStartSeconds, markedEndSeconds: c.markedEndSeconds,
      notes: '', coachingPoints: [],
      credit: { coachName: null, url: null, sourceTitle: null, channelName: null, channelUrl: null },
      thumbnailUrl: null,
      filmId: (c.legacy.gameId && filmIds.get(c.legacy.gameId)) || null,
      category: c.category,
      legacy: { id: c.legacy.id, index: c.legacy.index, gameId: c.legacy.gameId, playlistId: c.legacy.playlistId },
    });
  }
  return { teams, films, clips, skipped };
}

/* SHA-256 of the classic library keys: changes whenever classic Angl saves a
 * different library, so the film room can offer what's new. */
export async function fingerprint(source: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* What `incoming` adds to a library that already holds `have`: new ids only.
 * Anything already here is left as it is, so edits made in the film room are
 * never overwritten by a re-read of classic Angl or a re-import. */
export function newItems(have: { teams: Set<string>; films: Set<string>; clips: Set<string> }, incoming: LocalLibrary): LocalLibrary {
  return {
    teams: incoming.teams.filter(t => !have.teams.has(t.id)),
    films: incoming.films.filter(f => !have.films.has(f.id)),
    clips: incoming.clips.filter(c => !have.clips.has(c.id)),
  };
}
