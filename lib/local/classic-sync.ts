/*
 * Bringing classic Angl's library into the film room, when both are served
 * from the same address (run the site with `npm run local`, on port 8777 like
 * serve.sh). On any other address there is nothing to read and this is a no-op.
 *
 * First load: everything comes in, automatically. After that the film room
 * only notices when classic Angl's library has changed (by fingerprint), and
 * offers what is new rather than taking it unasked. Classic's keys are only
 * ever read (lib/legacy/read.ts).
 */
import { readLegacy, type ReadOnlyStorage } from '../legacy/read.ts';
import { fingerprint, legacyToV5, newItems } from '../legacy/to-v5.ts';
import type { SkippedClip } from '../legacy/convert.ts';
import type { LocalLibrary } from '../model/types.ts';
import { getAll, getMeta, getTombstones, putAll } from './idb.ts';

export interface ClassicMeta { fingerprint: string; importedAt: string; lastSyncedAt: string }

export type ClassicStatus =
  | { kind: 'none' }                                    // no classic library in this browser
  | { kind: 'current' }                                 // nothing changed since last time
  | { kind: 'imported'; added: LocalLibrary; skipped: SkippedClip[]; damaged: string[] }   // first load did it
  | { kind: 'new'; added: LocalLibrary; fingerprint: string; skipped: SkippedClip[]; damaged: string[] };

/* What the film room already has — or had, and was deleted on purpose */
async function haveIds(db: IDBDatabase) {
  const [teams, films, clips, gone] = await Promise.all([getAll(db, 'teams'), getAll(db, 'films'), getAll(db, 'clips'), getTombstones(db)]);
  return {
    teams: new Set([...teams.map(t => t.id), ...gone.teams]),
    films: new Set([...films.map(f => f.id), ...gone.films]),
    clips: new Set([...clips.map(c => c.id), ...gone.clips]),
  };
}

export async function checkClassic(db: IDBDatabase, storage: ReadOnlyStorage): Promise<ClassicStatus> {
  const read = readLegacy(storage);
  if (!read.present) return { kind: 'none' };
  const fp = await fingerprint(read.fingerprintSource);
  const meta = await getMeta<ClassicMeta>(db, 'classic');
  if (meta && meta.fingerprint === fp) return { kind: 'current' };

  const v5 = await legacyToV5(read.lib);
  const added = newItems(await haveIds(db), v5);
  const now = new Date().toISOString();

  if (!meta) {
    // The first time this browser opens the film room: bring the whole library across
    await putAll(db, {
      ...added,
      meta: { classic: { fingerprint: fp, importedAt: now, lastSyncedAt: now } satisfies ClassicMeta, extras: read.extras },
    });
    return { kind: 'imported', added, skipped: v5.skipped, damaged: read.damaged };
  }
  if (!added.clips.length && !added.films.length && !added.teams.length) {
    // Classic changed something the film room already has (a rename, a deletion).
    // Existing items are never overwritten, so there is nothing to offer.
    await putAll(db, { meta: { classic: { ...meta, fingerprint: fp, lastSyncedAt: now } } });
    return { kind: 'current' };
  }
  return { kind: 'new', added, fingerprint: fp, skipped: v5.skipped, damaged: read.damaged };
}

/* The coach said yes to "bring in N new clips". */
export async function bringInClassic(db: IDBDatabase, status: Extract<ClassicStatus, { kind: 'new' }>): Promise<void> {
  const meta = await getMeta<ClassicMeta>(db, 'classic');
  const now = new Date().toISOString();
  await putAll(db, { ...status.added, meta: { classic: { importedAt: meta?.importedAt ?? now, fingerprint: status.fingerprint, lastSyncedAt: now } } });
}
