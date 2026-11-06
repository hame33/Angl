'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { bringInClassic, checkClassic, type ClassicStatus } from '@/lib/local/classic-sync';
import { countLibrary, groupLibrary } from '@/lib/local/group';
import { getAll, getMeta, openLibrary, putAll } from '@/lib/local/idb';
import { buildExport, readExport } from '@/lib/model/export';
import type { LegacyExtras, LocalLibrary } from '@/lib/model/types';
import { newItems } from '@/lib/legacy/to-v5';
import { clock } from '@/lib/text';
import s from './film-room.module.css';

type Notice = { tone: 'ok' | 'bad' | 'info'; text: string } | null;
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const EMPTY: LocalLibrary = { teams: [], films: [], clips: [] };

/*
 * The film room's library, kept in this browser (Phase 4). Phase 5 adds the
 * player and clip editing here; for now it shows what is stored, brings in
 * classic Angl's library when served from the same address, and exports and
 * imports Angl files.
 */
export function FilmRoom() {
  const db = useRef<IDBDatabase | null>(null);
  const [lib, setLib] = useState<LocalLibrary | null>(null);
  const [classic, setClassic] = useState<ClassicStatus | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

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
        setNotice({ tone: 'bad', text: 'This browser won’t let the film room store anything (' + String((err as Error).message || err) + '). Private browsing can do that.' });
        setLib(EMPTY);
      }
    })();
    return () => { cancelled = true; };
  }, [reload]);

  async function bringIn() {
    if (classic?.kind !== 'new' || !db.current) return;
    setBusy(true);
    await bringInClassic(db.current, classic);
    setNotice({ tone: 'ok', text: `Brought in ${plural(classic.added.clips.length, 'clip')} from classic Angl.` });
    setClassic({ kind: 'current' });
    await reload();
    setBusy(false);
  }

  async function exportLibrary() {
    if (!db.current || !lib) return;
    const extras = (await getMeta<LegacyExtras>(db.current, 'extras')) ?? { durationModel: null, dictationLog: [] };
    const blob = new Blob([JSON.stringify(buildExport(lib, extras), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `angl-library-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function importFile(file: File) {
    if (!db.current || !lib) return;
    setBusy(true);
    setNotice(null);
    try {
      let data: unknown;
      try { data = JSON.parse(await file.text()); } catch { setNotice({ tone: 'bad', text: 'That file isn’t valid JSON.' }); return; }
      const r = await readExport(data);
      if (!r.ok) { setNotice({ tone: 'bad', text: r.message }); return; }
      const have = { teams: new Set(lib.teams.map(t => t.id)), films: new Set(lib.films.map(f => f.id)), clips: new Set(lib.clips.map(c => c.id)) };
      const added = newItems(have, r.library);
      await putAll(db.current, added);
      await reload();
      const already = r.library.clips.length - added.clips.length;
      setNotice({
        tone: 'ok',
        text: `Added ${plural(added.clips.length, 'clip')} from ${file.name}` +
          (already ? `; ${already} ${already === 1 ? 'was' : 'were'} already here and left as ${already === 1 ? 'it is' : 'they are'}` : '') +
          (r.skipped.length ? `; ${r.skipped.length} couldn’t be read` : '') + '.',
      });
    } finally {
      setBusy(false);
    }
  }

  if (!lib) return <main className={s.stack}><h1 className={s.h1}>Film room</h1><p className={s.muted}>Opening your library…</p></main>;
  const counts = countLibrary(lib);
  const groups = groupLibrary(lib);

  return (
    <main className={s.stack}>
      <div>
        <h1 className={s.h1}>Film room</h1>
        <p className={s.muted}>
          {plural(counts.clips, 'clip')} · {plural(counts.films, 'film')} · {plural(counts.teams, 'team')}.
          Kept in this browser; nothing leaves this device unless you export it or publish from the <Link href="/studio">studio</Link>.
        </p>
      </div>

      {classic?.kind === 'imported' && (
        <p className={`${s.notice} ${s.ok}`} role="status">
          Brought in your classic Angl library from this browser: {plural(classic.added.clips.length, 'clip')} in {plural(classic.added.films.length, 'film')}.
          Classic Angl is untouched and still works as before.
          {classic.skipped.length > 0 && ` ${plural(classic.skipped.length, 'clip')} couldn’t be read and ${classic.skipped.length === 1 ? 'was' : 'were'} left out.`}
        </p>
      )}
      {classic?.kind === 'new' && (
        <div className={`${s.notice} ${s.info}`} role="status">
          <p>Classic Angl has {plural(classic.added.clips.length, 'new clip')}
            {classic.added.films.length ? ` in ${plural(classic.added.films.length, 'new film')}` : ''} since you last brought it in.</p>
          <button className={s.button} onClick={bringIn} disabled={busy}>Bring {classic.added.clips.length === 1 ? 'it' : 'them'} in</button>
        </div>
      )}
      {classic && 'damaged' in classic && classic.damaged.length > 0 && (
        <p className={`${s.notice} ${s.bad}`} role="alert">
          Part of the classic library couldn’t be read ({classic.damaged.join(', ')}). Everything else came across; classic Angl still has its copy.
        </p>
      )}
      {notice && <p className={`${s.notice} ${s[notice.tone]}`} role="status">{notice.text}</p>}

      <div className={s.row}>
        <button className={s.ghost} onClick={exportLibrary} disabled={busy || !counts.clips}>Export library</button>
        <label className={s.ghost}>
          Import a file
          <input type="file" accept=".json,application/json" hidden disabled={busy}
                 onChange={e => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ''; }} />
        </label>
      </div>

      {groups.length === 0 ? (
        <section className={s.empty}>
          <p><strong>No library here yet.</strong></p>
          <p className={s.muted}>
            Import an Angl export with the button above, or open this page on the computer where you use classic
            Angl, served at <code>http://localhost:8777</code> with <code>npm run local</code>. Your clips there come in automatically.
          </p>
        </section>
      ) : groups.map(t => (
        <section key={t.team?.id ?? 'none'} className={s.team}>
          <h2 className={s.h2}>{t.team ? t.team.name : 'No team'} · {t.count}</h2>
          {t.films.map(f => (
            <details key={f.film.id} className={s.film}>
              <summary><span>{f.film.title}</span><span className={s.muted}>{f.count}</span></summary>
              {f.categories.map(c => (
                <div key={c.name}>
                  <div className={s.cat}>{c.emoji ? `${c.emoji} ` : ''}{c.name} · {c.clips.length}</div>
                  {c.clips.length > 0 && (
                    <ul className={s.clips}>
                      {c.clips.map(clip => (
                        <li key={clip.id}>
                          <span>{clip.title}</span>
                          <span className={s.muted}>{clock(clip.startSeconds)}–{clock(clip.endSeconds)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </details>
          ))}
        </section>
      ))}
    </main>
  );
}
