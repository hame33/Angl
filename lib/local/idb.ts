/*
 * The film room's library in this browser: IndexedDB, not localStorage.
 *
 * localStorage holds about 5 MB per site, and classic Angl's library already
 * lives there. A second copy beside it could fill that quota, and classic
 * Angl's own saves would start failing (PLAN.md §3). IndexedDB has its own,
 * much larger allowance. Nothing here touches localStorage at all.
 *
 * A thin hand-written wrapper — IndexedDB's API is old-fashioned but small,
 * and this is all the film room needs.
 */
import type { Clip, Film, Team } from '../model/types.ts';

const DB_NAME = 'angl';
const DB_VERSION = 1;
export type StoreName = 'teams' | 'films' | 'clips' | 'meta';
type Row = { teams: Team; films: Film; clips: Clip; meta: { key: string; value: unknown } };

const done = <T>(req: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
const finished = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
});

export function openLibrary(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of ['teams', 'films', 'clips'] as const) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('The film room is open in another tab with an older version. Close it and reload.'));
  });
}

export async function getAll<S extends Exclude<StoreName, 'meta'>>(db: IDBDatabase, store: S): Promise<Row[S][]> {
  return done(db.transaction(store, 'readonly').objectStore(store).getAll()) as Promise<Row[S][]>;
}

export async function getMeta<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
  const row = await done(db.transaction('meta', 'readonly').objectStore('meta').get(key)) as Row['meta'] | undefined;
  return row?.value as T | undefined;
}

/* Several stores in one transaction: either everything lands, or nothing does. */
export async function putAll(db: IDBDatabase, items: { teams?: Team[]; films?: Film[]; clips?: Clip[]; meta?: Record<string, unknown> }): Promise<void> {
  const stores = (['teams', 'films', 'clips', 'meta'] as const).filter(s => (s === 'meta' ? items.meta && Object.keys(items.meta).length : items[s]?.length));
  if (!stores.length) return;
  const tx = db.transaction(stores, 'readwrite');
  for (const s of stores) {
    const os = tx.objectStore(s);
    if (s === 'meta') for (const [key, value] of Object.entries(items.meta!)) os.put({ key, value });
    else for (const row of items[s]!) os.put(row);
  }
  await finished(tx);
}

export interface Tombstones { teams: string[]; films: string[]; clips: string[] }
const TOMBSTONE_KEY = 'deleted';

/*
 * One change set, in one transaction: puts, deletes, and the tombstones that
 * remember what was deleted. Without those, the next "bring in from classic
 * Angl" would offer a deleted clip straight back (PLAN.md Phase 4 note).
 * `restore` lifts tombstones for ids a file import is bringing back on purpose.
 */
export async function commit(db: IDBDatabase, ch: {
  put?: { teams?: Team[]; films?: Film[]; clips?: Clip[] };
  remove?: { teams?: string[]; films?: string[]; clips?: string[] };
  restore?: boolean;
}): Promise<void> {
  const put = ch.put ?? {}, remove = ch.remove ?? {};
  const tx = db.transaction(['teams', 'films', 'clips', 'meta'], 'readwrite');
  const meta = tx.objectStore('meta');
  const current = ((await done(meta.get(TOMBSTONE_KEY)) as Row['meta'] | undefined)?.value as Tombstones | undefined) ?? { teams: [], films: [], clips: [] };
  const next: Tombstones = { teams: [...current.teams], films: [...current.films], clips: [...current.clips] };
  for (const s of ['teams', 'films', 'clips'] as const) {
    const os = tx.objectStore(s);
    for (const row of put[s] ?? []) os.put(row);
    for (const id of remove[s] ?? []) { os.delete(id); if (!next[s].includes(id)) next[s].push(id); }
    if (ch.restore) { const back = new Set((put[s] ?? []).map(r => r.id)); next[s] = next[s].filter(id => !back.has(id)); }
  }
  meta.put({ key: TOMBSTONE_KEY, value: next });
  await finished(tx);
}

export async function getTombstones(db: IDBDatabase): Promise<Tombstones> {
  return (await getMeta<Tombstones>(db, TOMBSTONE_KEY)) ?? { teams: [], films: [], clips: [] };
}
