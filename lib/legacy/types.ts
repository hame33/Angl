/*
 * Classic Angl's stored shapes, as index.html writes them (filmroom_* keys)
 * and as its Export file carries them (versions 1–4). Every field is optional
 * because files in the wild predate most of them; the converter decides what
 * a missing field means, exactly as the classic migrations do.
 */
export interface LegacyClip {
  id?: string;
  label?: string;
  videoId?: string | null;
  gameId?: string;
  playlistId?: string;
  start?: number;
  end?: number;
  bufBefore?: number;
  bufAfter?: number;
  effStart?: number;
  effEnd?: number;
}
export interface LegacyPlaylist { id?: string; gameId?: string; name?: string; emoji?: string }
export interface LegacyGame { id?: string; teamId?: string; title?: string; videoId?: string | null; createdAt?: number; autoTitle?: boolean }
export interface LegacyTeam { id?: string; name?: string; sport?: string; createdAt?: number }

export interface LegacyLibrary {
  clips: LegacyClip[];
  playlists: LegacyPlaylist[];
  games: LegacyGame[];
  teams: LegacyTeam[];
}

/* What makes the ported migrations repeatable: classic Angl uses Math.random
 * ids and Date.now(); tests and the cross-check inject their own. */
export interface MigrateDeps { uid: () => string; now: () => number }
