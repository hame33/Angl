/*
 * Reads classic Angl's library out of this browser's localStorage, the way
 * index.html's loadFromStorage() does — and never writes a thing.
 *
 * That is the whole contract with classic Angl (PLAN.md §3, CONTRIBUTING.md):
 * no filmroom_ key is ever set, renamed or removed from here, not even the
 * `_corrupt` twin classic Angl makes for an unreadable key. Classic Angl keeps
 * working off its own keys, at its own state, whatever happens on this side.
 * The storage handed in is typed read-only so a write can't even compile.
 */
import { migrateToGames, migrateToTeams } from './migrate.ts';
import type { LegacyLibrary, MigrateDeps } from './types.ts';

export interface ReadOnlyStorage { getItem(key: string): string | null }

/* Every key classic Angl stores, in the order its loader reads them. */
export const LEGACY_LIST_KEYS = ['filmroom_clips', 'filmroom_playlists', 'filmroom_games', 'filmroom_teams'] as const;
export const LEGACY_KEYS = [
  ...LEGACY_LIST_KEYS, 'filmroom_video', 'filmroom_active_game', 'filmroom_active_team',
  'filmroom_duration_model', 'filmroom_dictation_log', 'filmroom_settings', 'filmroom_hotkey',
] as const;

export interface LegacyRead {
  present: boolean;              // any classic data at all in this browser
  lib: LegacyLibrary;            // migrated exactly as classic Angl would
  damaged: string[];             // list keys that exist but don't parse: only their own data is lost
  extras: { durationModel: unknown; dictationLog: unknown[]; settings: unknown; hotkey: string | null };
  fingerprintSource: string;     // the raw library keys, for spotting later changes
}

/* null = not stored, false = stored but unreadable (classic readStoredList's contract) */
function readList(storage: ReadOnlyStorage, key: string): unknown[] | null | false {
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* falls through */ }
  return false;
}

function readJson(storage: ReadOnlyStorage, key: string): unknown {
  const raw = storage.getItem(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/*
 * Ids for games and teams the migrations have to invent. Classic Angl uses
 * Math.random, which would give a pre-games library new film ids on every
 * read here; a counter makes the same library always produce the same ids.
 */
export function deterministicDeps(): MigrateDeps {
  let n = 0;
  return { uid: () => `migrated-${++n}`, now: () => 0 };
}

export function readLegacy(storage: ReadOnlyStorage): LegacyRead {
  const lists = Object.fromEntries(LEGACY_LIST_KEYS.map(k => [k, readList(storage, k)])) as Record<(typeof LEGACY_LIST_KEYS)[number], unknown[] | null | false>;
  const asObjects = (v: unknown[] | null | false) => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object').map(x => ({ ...(x as object) })) : []);
  const lib: LegacyLibrary = {
    clips: asObjects(lists.filmroom_clips),
    playlists: asObjects(lists.filmroom_playlists),
    games: asObjects(lists.filmroom_games),
    teams: asObjects(lists.filmroom_teams),
  };
  const damaged = LEGACY_LIST_KEYS.filter(k => lists[k] === false).map(k => k.replace('filmroom_', ''));

  // Same order as classic loadFromStorage: games first, from the old single-video key
  const deps = deterministicDeps();
  const legacyVideo = storage.getItem('filmroom_video');
  if (!lib.games.length) migrateToGames(lib, legacyVideo, deps);
  migrateToTeams(lib, deps);

  const log = readJson(storage, 'filmroom_dictation_log');
  return {
    present: LEGACY_KEYS.some(k => storage.getItem(k) !== null),
    lib,
    damaged,
    extras: {
      durationModel: readJson(storage, 'filmroom_duration_model'),
      dictationLog: Array.isArray(log) ? log : [],
      settings: readJson(storage, 'filmroom_settings'),
      hotkey: storage.getItem('filmroom_hotkey'),
    },
    // Only what defines the library: UI state and the log don't count as "new clips"
    fingerprintSource: [...LEGACY_LIST_KEYS, 'filmroom_video'].map(k => `${k}=${storage.getItem(k) ?? ''}`).join('\n'),
  };
}
