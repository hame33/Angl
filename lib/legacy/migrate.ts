/*
 * Classic Angl's two library migrations, ported line for line from
 * index.html (migrateToGames, migrateToTeams) so an old library converts here
 * exactly as it would there. lib/legacy/migrate.test.ts runs both on the same
 * fixtures and compares the results — if you change one, change the other.
 *
 * These work on a copy; nothing here touches a filmroom_ key.
 */
import type { LegacyLibrary, MigrateDeps } from './types.ts';

// Classic Angl's defaults: a library with no sport on record is basketball
export const DEFAULT_TEAM_NAME = 'My team';
export const DEFAULT_SPORT = 'basketball';
const FALLBACK_CATEGORY = { name: 'General', emoji: '🏀' };

export const defaultDeps: MigrateDeps = {
  uid: () => Math.random().toString(36).slice(2, 9),
  now: () => Date.now(),
};

/* Saves made before games existed: rebuild a game per distinct film, and copy
 * each old playlist into every game that used it. */
export function migrateToGames(lib: LegacyLibrary, legacyVideoId: string | null, deps: MigrateDeps = defaultDeps): void {
  const { clips } = lib;
  if (!clips.length && !lib.playlists.length && !legacyVideoId) return;

  const byVideo = new Map<string, { videoId: string | null; list: typeof clips }>();
  for (const c of clips) {
    const vid = c.videoId || legacyVideoId || null;
    const key = vid || '__unknown__';
    if (!byVideo.has(key)) byVideo.set(key, { videoId: vid, list: [] });
    byVideo.get(key)!.list.push(c);
  }
  // A film loaded but never clipped is kept, and so are categories set up
  // before the first clip — they need a (possibly filmless) game to live in.
  if (!byVideo.size && (legacyVideoId || lib.playlists.length)) {
    byVideo.set(legacyVideoId || '__unknown__', { videoId: legacyVideoId || null, list: [] });
  }

  const oldPlaylists = lib.playlists;
  lib.playlists = [];
  let n = 0;

  for (const { videoId, list } of byVideo.values()) {
    n++;
    const game = { id: deps.uid(), title: 'Game ' + n, videoId, createdAt: deps.now(), autoTitle: !!videoId };
    lib.games.push(game);

    // Keys may be undefined: a playlist saved without a name stays nameless, as it does in classic Angl
    const byName = new Map<string | undefined, { id: string; gameId: string; name?: string; emoji?: string }>();
    for (const c of list) {
      const old = oldPlaylists.find(pl => pl.id === c.playlistId);
      const name = old ? old.name : FALLBACK_CATEGORY.name;
      const emoji = old ? old.emoji : FALLBACK_CATEGORY.emoji;
      if (!byName.has(name)) {
        const pl = { id: deps.uid(), gameId: game.id, name, emoji };
        byName.set(name, pl);
        lib.playlists.push(pl);
      }
      c.gameId = game.id;
      c.playlistId = byName.get(name)!.id;
      if (!c.videoId && videoId) c.videoId = videoId;
    }
    if (!byName.size) {
      lib.playlists.push({ id: deps.uid(), gameId: game.id, name: FALLBACK_CATEGORY.name, emoji: FALLBACK_CATEGORY.emoji });
    }
  }

  // Playlists that never held a clip are parked on the first game
  const first = lib.games[0];
  if (first) {
    for (const op of oldPlaylists) {
      if (!lib.playlists.some(pl => pl.name === op.name)) {
        lib.playlists.push({ id: deps.uid(), gameId: first.id, name: op.name, emoji: op.emoji });
      }
    }
  }
}

/* Saves made before teams existed: every game needs an owner. */
export function migrateToTeams(lib: LegacyLibrary, deps: MigrateDeps = defaultDeps): void {
  const orphans = lib.games.filter(g => !g.teamId);
  if (!orphans.length) return;
  let team = lib.teams[0];
  if (!team) {
    team = { id: deps.uid(), name: DEFAULT_TEAM_NAME, sport: DEFAULT_SPORT, createdAt: deps.now() };
    lib.teams.push(team);
  }
  for (const g of orphans) g.teamId = team.id;
}

/*
 * An Export file (any version) to a fully migrated library, the way classic
 * Angl's Import button does it: a version 1 file has no games, so they are
 * rebuilt from the clips' videoIds; a version 2 file has no teams.
 * Returns null when the file is not an Angl export at all.
 */
export function libraryFromExport(data: unknown, deps: MigrateDeps = defaultDeps): LegacyLibrary | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  if (!d.clips && !d.playlists && !d.games) return null;
  const list = <T>(v: unknown): T[] =>
    Array.isArray(v) ? (v.filter(x => x && typeof x === 'object').map(x => ({ ...(x as object) })) as T[]) : [];
  // Copies, so the caller's parsed file is never mutated
  const lib: LegacyLibrary = { clips: list(d.clips), playlists: list(d.playlists), games: list(d.games), teams: list(d.teams) };
  if (!lib.games.length) migrateToGames(lib, null, deps);
  migrateToTeams(lib, deps);
  return lib;
}
