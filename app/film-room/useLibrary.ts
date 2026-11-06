'use client';
/*
 * The film room's library in React state, kept in step with IndexedDB. Every
 * change goes through run(): the op's change set is applied to the screen and
 * committed to the browser's store together, deletions remembered.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { bringInClassic, checkClassic, type ClassicStatus } from '@/lib/local/classic-sync';
import { commit, getAll, openLibrary } from '@/lib/local/idb';
import { apply, OpError, type Changes } from '@/lib/filmroom/ops';
import type { LocalLibrary } from '@/lib/model/types';

export interface LibraryApi {
  lib: LocalLibrary | null;
  db: IDBDatabase | null;
  classic: ClassicStatus | null;
  failure: string | null;
  /* Apply a change set; returns an error message instead of throwing */
  run: (make: () => Changes, opts?: { restore?: boolean }) => Promise<string | null>;
  bringIn: () => Promise<number>;
  reload: () => Promise<void>;
}

export function useLibrary(): LibraryApi {
  const db = useRef<IDBDatabase | null>(null);
  const [lib, setLib] = useState<LocalLibrary | null>(null);
  const [classic, setClassic] = useState<ClassicStatus | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const libRef = useRef<LocalLibrary | null>(null);
  libRef.current = lib;

  const reload = useCallback(async () => {
    const d = db.current!;
    const [teams, films, clips] = await Promise.all([getAll(d, 'teams'), getAll(d, 'films'), getAll(d, 'clips')]);
    setLib({ teams, films, clips });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        db.current = await openLibrary();
        let status: ClassicStatus = { kind: 'none' };
        try { status = await checkClassic(db.current, window.localStorage); }
        catch { /* storage blocked (private mode): the film room still works from its own store */ }
        if (cancelled) return;
        setClassic(status);
        await reload();
      } catch (err) {
        setFailure('This browser won’t let the film room store anything (' + String((err as Error).message || err) + '). Private browsing can do that.');
        setLib({ teams: [], films: [], clips: [] });
      }
    })();
    return () => { cancelled = true; };
  }, [reload]);

  const run = useCallback(async (make: () => Changes, opts?: { restore?: boolean }) => {
    if (!libRef.current || !db.current) return 'The library isn’t open yet';
    let ch: Changes;
    try { ch = make(); }
    catch (e) { if (e instanceof OpError) return e.message; throw e; }
    const next = apply(libRef.current, ch);
    libRef.current = next;
    setLib(next);
    try {
      await commit(db.current, { ...ch, restore: opts?.restore });
      return null;
    } catch (e) {
      // The screen ran ahead of the store: put it back to what is actually saved
      await reload();
      return 'Couldn’t save that change: ' + String((e as Error).message || e);
    }
  }, [reload]);

  const bringIn = useCallback(async () => {
    if (classic?.kind !== 'new' || !db.current) return 0;
    await bringInClassic(db.current, classic);
    setClassic({ kind: 'current' });
    await reload();
    return classic.added.clips.length;
  }, [classic, reload]);

  return { lib, db: db.current, classic, failure, run, bringIn, reload };
}
