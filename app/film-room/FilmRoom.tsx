'use client';

import { useCallback, useEffect, useState } from 'react';
import { getMeta } from '@/lib/local/idb';
import { buildExport, readExport } from '@/lib/model/export';
import type { Clip, LegacyExtras } from '@/lib/model/types';
import type { Selection } from '@/lib/filmroom/view';
import { newItems } from '@/lib/legacy/to-v5';
import { Dashboard, type Notice } from './Dashboard';
import { FilmView } from './FilmView';
import { useLibrary } from './useLibrary';
import s from './film-room.module.css';

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/*
 * The film room: the library (dashboard) and one film at a time. The
 * browser's back button steps from a film back to the library, so a phone's
 * back gesture does what a coach expects instead of leaving the page.
 */
export function FilmRoom() {
  const api = useLibrary();
  const { lib } = api;
  const [teamId, setTeamId] = useState<string | null | undefined>(undefined);
  const [sel, setSelState] = useState<Selection | null>(null);
  const [startWith, setStartWith] = useState<Clip | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  // Land on a real team rather than the mixed view, as classic Angl does — and
  // reopen the film or category the address names, so a reload (or a phone
  // bringing the tab back) returns to where the coach was.
  useEffect(() => {
    if (!lib || teamId !== undefined) return;
    const q = new URLSearchParams(window.location.search);
    const film = lib.films.find(f => f.id === q.get('film'));
    const team = film?.teamId ?? lib.teams[0]?.id ?? null;
    setTeamId(team);
    if (film) setSelState({ kind: 'film', filmId: film.id, category: null });
    else if (q.get('category')) setSelState({ kind: 'category', name: q.get('category')!, teamId: team });
    if (film || q.get('category')) history.replaceState({ filmRoom: film ? { kind: 'film', filmId: film.id, category: null } : { kind: 'category', name: q.get('category'), teamId: team } }, '', window.location.href);
  }, [lib, teamId]);

  const open = useCallback((next: Selection, play?: Clip) => {
    setStartWith(play ?? null);
    setSelState(next);
    history.pushState({ filmRoom: next }, '', next.kind === 'film' ? `?film=${next.filmId}` : `?category=${encodeURIComponent(next.name)}`);
  }, []);
  const setSel = useCallback((next: Selection) => {
    setStartWith(null);
    setSelState(next);
    history.replaceState({ filmRoom: next }, '', next.kind === 'film' ? `?film=${next.filmId}` : `?category=${encodeURIComponent(next.name)}`);
  }, []);
  const back = useCallback(() => {
    if (history.state?.filmRoom) history.back();
    else { setSelState(null); history.replaceState(null, '', '/film-room'); }
  }, []);
  useEffect(() => {
    const onPop = (e: PopStateEvent) => { setStartWith(null); setSelState((e.state?.filmRoom as Selection) ?? null); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  // A film that was deleted (or never existed) falls back to the library
  useEffect(() => {
    if (lib && sel?.kind === 'film' && !lib.films.some(f => f.id === sel.filmId)) { setSelState(null); history.replaceState(null, '', '/film-room'); }
  }, [lib, sel]);

  async function exportLibrary() {
    if (!api.db || !lib) return;
    const extras = (await getMeta<LegacyExtras>(api.db, 'extras')) ?? { durationModel: null, dictationLog: [] };
    const blob = new Blob([JSON.stringify(buildExport(lib, extras), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `angl-library-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function importFile(file: File) {
    if (!lib) return;
    setBusy(true);
    setNotice(null);
    try {
      let data: unknown;
      try { data = JSON.parse(await file.text()); } catch { setNotice({ tone: 'bad', text: 'That file isn’t valid JSON.' }); return; }
      const r = await readExport(data);
      if (!r.ok) { setNotice({ tone: 'bad', text: r.message }); return; }
      const have = { teams: new Set(lib.teams.map(t => t.id)), films: new Set(lib.films.map(f => f.id)), clips: new Set(lib.clips.map(c => c.id)) };
      const added = newItems(have, r.library);
      // An import is a deliberate restore: it may bring back clips deleted here
      const err = await api.run(() => ({ put: added, remove: {} }), { restore: true });
      if (err) { setNotice({ tone: 'bad', text: err }); return; }
      if (teamId === null && added.teams[0]) setTeamId(added.teams[0].id);
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

  if (!lib || teamId === undefined) return <main className={s.stack}><h1 className={s.h1}>Film room</h1><p className={s.muted}>Opening your library…</p></main>;
  if (sel) return <FilmView key={sel.kind === 'film' ? sel.filmId : `cat:${sel.name}`} api={api} lib={lib} sel={sel} setSel={setSel} back={back} startWith={startWith} />;
  return (
    <Dashboard api={api} lib={lib} teamId={teamId} setTeamId={setTeamId} open={open}
               notice={notice} setNotice={setNotice} onExport={exportLibrary} onImport={importFile} busy={busy} />
  );
}
