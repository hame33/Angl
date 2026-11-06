/*
 * Angl's library model, version 5 (PLAN.md §2). The same shapes are used in
 * the browser's local store, the export file, and later the API and the
 * language-model tools — camelCase JSON, units in the names, no derived fields.
 *
 * Phase 4 covers teams, films and clips: what classic Angl already holds.
 * Drills and session plans join in later phases without changing these.
 */
export type Uuid = string;
export type IsoDateTime = string;
export type Visibility = 'private' | 'unlisted' | 'public';
export type CreatedVia = 'manual' | 'import' | 'ai';

export interface Team {
  id: Uuid;
  ownerId: Uuid | null;          // null while the library is only on this device
  name: string;
  sport: string;                 // classic Angl's sport profile id: 'basketball', 'netball'
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  legacyId: string | null;
}

export interface Film {
  id: Uuid;
  ownerId: Uuid | null;
  teamId: Uuid | null;
  title: string;
  video: { provider: 'youtube'; videoId: string | null };
  categories: { name: string; emoji: string }[];   // classic playlists of this game, in order
  autoTitle?: boolean;           // no title was typed: take the video's own once the player knows it
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  legacyId: string | null;
}

export interface Clip {
  kind: 'clip';
  id: Uuid;
  ownerId: Uuid | null;
  shareId: string | null;        // assigned by the server when shared
  visibility: Visibility;
  title: string;
  tags: string[];
  createdVia: CreatedVia;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  publishedAt: IsoDateTime | null;
  video: { provider: 'youtube'; videoId: string | null };
  startSeconds: number;          // first second played
  endSeconds: number;            // last second played
  markedStartSeconds: number | null;
  markedEndSeconds: number | null;
  notes: string;
  coachingPoints: string[];
  credit: {
    coachName: string | null;
    url: string | null;
    sourceTitle: string | null;
    channelName: string | null;
    channelUrl: string | null;
  };
  thumbnailUrl: string | null;
  filmId: Uuid | null;
  category: string | null;
  legacy: { id: string; index: number; gameId: string | null; playlistId: string | null } | null;
}

/* Carried over from classic Angl untouched, for the dictation port (Phase 6). */
export interface LegacyExtras {
  durationModel: unknown;
  dictationLog: unknown[];
  settings: unknown;             // includes a BYO API key: stays on this device, never synced
  hotkey: string | null;
}

export interface LocalLibrary {
  teams: Team[];
  films: Film[];
  clips: Clip[];
}

/* The export file. Classic Angl wrote versions 1–4; this is 5. */
export interface LibraryExport extends LocalLibrary {
  format: 'angl.library';
  version: 5;
  exportedAt: IsoDateTime;
  drills: [];                    // Phase 8
  plans: [];                     // Phase 9
  durationModel: unknown;
  dictationLog: unknown[];
}
