'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseClock, parseLines, parseTags } from '@/lib/clip-form';
import {
  addCategory, addClip, autoTitleFilm, buffers, deleteCategory, deleteClips, realCtx, renameCategory, renameFilm, updateClip,
} from '@/lib/filmroom/ops';
import { emojiChoices, sport } from '@/lib/filmroom/sports';
import { filmClips, step, teamFilms, visibleClips, type Selection } from '@/lib/filmroom/view';
import type { Clip, Film, LocalLibrary } from '@/lib/model/types';
import { clock } from '@/lib/text';
import type { Notice } from './Dashboard';
import type { LibraryApi } from './useLibrary';
import { usePlayer } from './usePlayer';
import s from './film-room.module.css';

type Tab = 'add' | 'clips' | 'cats';
const SEEK_STEP = 10;
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const typingInto = (el: EventTarget | null) => el instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable);

interface Props {
  api: LibraryApi;
  lib: LocalLibrary;
  sel: Selection;
  setSel: (sel: Selection) => void;
  back: () => void;
  startWith: Clip | null;
}

/*
 * One film (or one category across a team's films), its player, and the clip
 * tools. Ported from classic Angl's film view: the same playback rules, the
 * same forms, on a phone as tabs and on a wide screen as three columns.
 */
export function FilmView({ api, lib, sel, setSel, back, startWith }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const onTitle = useCallback((videoId: string, title: string) => {
    const film = lib.films.find(f => f.video.videoId === videoId && f.autoTitle);
    if (film) void api.run(() => autoTitleFilm(lib, film.id, title, realCtx()));
  }, [api, lib]);
  const player = usePlayer(host, onTitle);

  const clips = useMemo(() => visibleClips(lib, sel), [lib, sel]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loadedFilmId, setLoadedFilmId] = useState<string | null>(sel.kind === 'film' ? sel.filmId : null);
  const [loop, setLoop] = useState(false);
  const [free, setFree] = useState(false);
  const [playAll, setPlayAll] = useState(false);
  const [tab, setTab] = useState<Tab>('add');
  const [editId, setEditId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [tc, setTc] = useState({ now: 0, total: 0 });

  const active = clips.find(c => c.id === activeId) ?? null;
  // The film whose video is on screen is where new clips go (classic filmGame)
  const film = lib.films.find(f => f.id === (sel.kind === 'film' ? sel.filmId : loadedFilmId))
    ?? (sel.kind === 'category' ? lib.films.find(f => f.id === clips[0]?.filmId) : undefined) ?? null;
  const team = lib.teams.find(t => t.id === film?.teamId) ?? null;
  const say = (err: string | null, ok?: string) => setNotice(err ? { tone: 'bad', text: err } : ok ? { tone: 'ok', text: ok } : null);

  // Open the film when the view (or the film) changes
  useEffect(() => {
    if (startWith) return;   // playClip below loads it at the right moment
    if (film?.video.videoId && player.videoId !== film.video.videoId) player.load(film.video.videoId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [film?.id]);

  const playClip = useCallback((clip: Clip, keepPlayAll = false) => {
    setFree(false);
    if (!keepPlayAll) setPlayAll(false);
    setActiveId(clip.id);
    if (clip.filmId) setLoadedFilmId(clip.filmId);
    const vid = clip.video.videoId;
    if (!vid) return;
    if (player.videoId !== vid) player.load(vid, clip.startSeconds, true);
    else { player.seek(clip.startSeconds); player.play(); }
  }, [player]);

  // Arriving from the dashboard's recent clips: play that one
  const started = useRef(false);
  useEffect(() => {
    if (startWith && !started.current) { started.current = true; playClip(startWith); }
  }, [startWith, playClip]);

  // The clip watcher (classic startWatcher): stop, loop or advance at the end
  useEffect(() => {
    if (!player.playing || !active || free) return;
    const id = setInterval(() => {
      if (player.videoId !== active.video.videoId) return;   // the next film is still loading
      const t = player.time();
      if (t < active.startSeconds - 1 || t < active.endSeconds) return;
      if (loop) { player.seek(active.startSeconds); player.play(); }
      else if (playAll) {
        const i = clips.findIndex(c => c.id === active.id);
        if (i >= 0 && i < clips.length - 1) playClip(clips[i + 1]!, true);
        else { player.pause(); setPlayAll(false); say(null, 'End of the list'); }
      } else player.pause();
    }, playAll ? 150 : 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.playing, active, free, loop, playAll, clips, playClip]);

  // Always-on timecode, so the time stays right while paused or scrubbing
  useEffect(() => {
    if (!player.ready) return;
    const id = setInterval(() => setTc({ now: player.time(), total: player.duration() }), 250);
    return () => clearInterval(id);
  }, [player, player.ready]);

  const nudge = useCallback((secs: number) => {
    const t = Math.max(0, player.time() + secs);
    // Landing outside the clip would have the watcher stop you; free scrub instead
    if (active && (t < active.startSeconds || t > active.endSeconds)) { setFree(true); setActiveId(null); }
    player.seek(t);
  }, [player, active]);

  const go = useCallback((dir: 1 | -1) => {
    const i = step(clips.length, clips.findIndex(c => c.id === activeId), dir);
    if (i >= 0) playClip(clips[i]!);
  }, [clips, activeId, playClip]);

  // Classic's keyboard: Space plays, arrows scrub, Shift+arrows step through clips
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typingInto(e.target)) return;
      if (e.key === ' ') { e.preventDefault(); if (player.playing) player.pause(); else if (active) playClip(active, true); else player.play(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); if (e.shiftKey) go(1); else nudge(SEEK_STEP); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); if (e.shiftKey) go(-1); else nudge(-SEEK_STEP); }
    };
    // Clicking the video hands keyboard focus to YouTube's frame; take it back
    const onBlur = () => setTimeout(() => {
      const el = document.activeElement;
      if (el instanceof HTMLIFrameElement && host.current?.contains(el)) { el.blur(); window.focus(); }
    }, 0);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onBlur);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('blur', onBlur); };
  }, [player, active, playClip, go, nudge]);

  function togglePlayAll() {
    if (playAll) { setPlayAll(false); player.pause(); return; }
    if (!clips.length) { say('No clips to play'); return; }
    setPlayAll(true);
    playClip(active ?? clips[0]!, true);
  }

  function toggleFree() {
    if (free) { setFree(false); return; }
    setFree(true); setActiveId(null);
  }

  async function clearList() {
    if (!clips.length) return;
    const scope = sel.kind === 'category' ? `all ${clips.length} clip(s) in "${sel.name}" across every film`
      : sel.category ? `all ${clips.length} clip(s) in "${sel.category}"` : `all ${clips.length} clip(s) in "${film?.title}"`;
    if (!confirm(`Delete ${scope}?\n\nThis can’t be undone.`)) return;
    setActiveId(null);
    say(await api.run(() => deleteClips(clips.map(c => c.id))), 'Deleted.');
  }

  const listTitle = sel.kind === 'category' ? `${sel.name} · every film` : sel.category ?? 'All clips';
  const marker = active && tc.total && player.videoId === active.video.videoId
    ? { left: `${(active.startSeconds / tc.total) * 100}%`, width: `${Math.max(0.3, ((active.endSeconds - active.startSeconds) / tc.total) * 100)}%` }
    : null;

  return (
    <main className={s.room}>
      <header className={s.roomHead}>
        <button className={s.ghost} onClick={back}>← Library</button>
        <div className={s.roomTitle}>
          <strong>{sel.kind === 'category' ? `${sel.name} · every film` : film?.title ?? 'Film'}</strong>
          {team && <span className={s.muted}>{team.name}</span>}
        </div>
        {sel.kind === 'film' && film && (
          <button className={s.ghost} onClick={async () => { const n = prompt('Rename film', film.title); if (n !== null) say(await api.run(() => renameFilm(lib, film.id, n, realCtx()))); }}>Rename</button>
        )}
      </header>

      <div className={s.playerArea}>
        <div className={s.player}>
          <div ref={host} className={s.playerHost}>
            {!film?.video.videoId && <p className={s.muted}>This film has no video.</p>}
          </div>
          {player.ready && <span className={s.timecode}>{clock(tc.now)} / {tc.total ? clock(tc.total) : '--:--'}</span>}
        </div>
        {player.ready && (
          <div className={s.progress} aria-hidden="true">
            {marker && <span className={s.progressClip} style={marker} />}
            <span className={s.progressFill} style={{ width: `${tc.total ? Math.min(100, (tc.now / tc.total) * 100) : 0}%` }} />
          </div>
        )}

        <div className={s.playbar}>
          <button className={s.playBtn} disabled={!active && !player.ready}
                  onClick={() => (player.playing ? player.pause() : active ? playClip(active, true) : player.play())}
                  aria-label={player.playing ? 'Pause' : 'Play'}>
            {player.playing ? '❚❚' : '▶'}
          </button>
          <button className={s.iconBtn} onClick={() => go(-1)} aria-label="Previous clip" title="Previous clip (Shift+←)">⏮</button>
          <button className={s.iconBtn} onClick={() => go(1)} aria-label="Next clip" title="Next clip (Shift+→)">⏭</button>
          <div className={s.now}>
            <div className={s.nowLabel}>{free ? 'Free scrub' : active?.title ?? 'No clip selected'}</div>
            <div className={s.muted}>{free ? 'Clip limits off — scrub and play freely' : active ? `${clock(active.startSeconds)} → ${clock(active.endSeconds)}` : 'Pick a clip, or add one'}</div>
          </div>
          <label className={`${s.toggle} ${loop ? s.on : ''}`}><input type="checkbox" checked={loop} onChange={e => setLoop(e.target.checked)} /> Loop</label>
          <button className={`${s.toggle} ${free ? s.on : ''}`} onClick={toggleFree} title="Release the clip limits and scrub freely">Free scrub</button>
        </div>
      </div>

      {notice && <p className={`${s.notice} ${s[notice.tone]} ${s.roomNotice}`} role="status">{notice.text}</p>}

      <nav className={s.tabs} role="tablist" aria-label="Film tools">
        {([['add', 'Add clip'], ['clips', `Clips · ${clips.length}`], ['cats', 'Categories']] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? s.tabOn : ''} onClick={() => setTab(k)}>{label}</button>
        ))}
      </nav>

      <section className={`${s.pane} ${s.paneAdd}`} data-active={tab === 'add' || undefined} aria-label="Add clip">
        {film ? <AddClipForm api={api} lib={lib} film={film} time={player.time} ready={player.ready} sportId={team?.sport}
                             onAdded={c => { say(null, 'Clip added — tap it in Clips to watch it'); setActiveId(c.id); }}
                             onError={e => say(e)} />
              : <p className={s.muted}>Play a clip to choose which film new clips go into.</p>}
      </section>

      <section className={`${s.pane} ${s.paneClips}`} data-active={tab === 'clips' || undefined} aria-label="Clips">
        <div className={s.paneHead}><strong>{listTitle}</strong><span className={s.muted}>{clips.length}</span></div>
        {clips.length === 0 ? <p className={s.muted}>No clips in this view.</p> : (
          <ol className={s.clipList}>
            {clips.map((c, i) => (
              <li key={c.id} className={c.id === activeId ? s.clipOn : ''}>
                <button className={s.clipMain} onClick={() => playClip(c)}>
                  <span className={s.clipNum}>{i + 1}</span>
                  <span className={s.clipBody}>
                    <span className={s.clipTitle}>{c.title}</span>
                    <span className={s.muted}>
                      {clock(c.startSeconds)} → {clock(c.endSeconds)}
                      {sel.kind === 'category' ? ` · ${lib.films.find(f => f.id === c.filmId)?.title ?? ''}` : sel.category === null && c.category ? ` · ${c.category}` : ''}
                    </span>
                  </span>
                </button>
                <button className={s.small} onClick={() => setEditId(editId === c.id ? null : c.id)} aria-expanded={editId === c.id}>{editId === c.id ? 'Close' : 'Edit'}</button>
                {editId === c.id && (
                  <ClipEditor api={api} lib={lib} clip={c} videoTitle={player.videoId === c.video.videoId ? player.title : null}
                              onDone={msg => { setEditId(null); say(null, msg); }} onError={e => say(e)} />
                )}
              </li>
            ))}
          </ol>
        )}
        <div className={s.row}>
          <button className={s.ghost} onClick={togglePlayAll}>{playAll ? '⏹ Stop' : '▶ Play all'}</button>
          <button className={s.ghost} onClick={clearList} disabled={!clips.length}>Clear list</button>
        </div>
      </section>

      <section className={`${s.pane} ${s.paneCats}`} data-active={tab === 'cats' || undefined} aria-label="Categories">
        {sel.kind === 'category' && (
          <p className={`${s.notice} ${s.info}`}>Showing <b>{sel.name}</b> across every film.{' '}
            {film && <button className={s.linkBtn} onClick={() => setSel({ kind: 'film', filmId: film.id, category: null })}>Back to {film.title}</button>}</p>
        )}
        {film && <Categories api={api} lib={lib} filmId={film.id} sel={sel} setSel={setSel} sportId={team?.sport} say={say} />}
        {film && (
          <label className={s.field}>
            <span className={s.label}>Switch film</span>
            <select className={s.select} value={sel.kind === 'film' ? sel.filmId : ''} onChange={e => e.target.value && setSel({ kind: 'film', filmId: e.target.value, category: null })}>
              {sel.kind === 'category' && <option value="">—</option>}
              {teamFilms(lib, film.teamId).map(f => <option key={f.id} value={f.id}>{f.title}</option>)}
            </select>
          </label>
        )}
      </section>
    </main>
  );
}

/* ── Add a clip (classic addClip and its form) ───────────────────────────── */

function AddClipForm({ api, lib, film, time, ready, sportId, onAdded, onError }: {
  api: LibraryApi; lib: LocalLibrary; film: Film; time: () => number; ready: boolean; sportId?: string;
  onAdded: (c: Clip) => void; onError: (e: string) => void;
}) {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [before, setBefore] = useState(2);
  const [after, setAfter] = useState(2);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState(film.categories[0]?.name ?? '');
  useEffect(() => { if (!film.categories.some(k => k.name === category)) setCategory(film.categories[0]?.name ?? ''); }, [film, category]);

  const capture = (set: (v: string) => void) => { if (!ready) { onError('Wait for the film to load'); return; } set(clock(time())); };

  async function add() {
    const st = parseClock(start);
    if (st === null) { onError('Enter a start time like 1:49, or tap ↓ Now'); return; }
    const en = end.trim() ? parseClock(end) : null;
    if (end.trim() && en === null) { onError('The end isn’t a time like 2:23'); return; }
    let made: Clip | null = null;
    const err = await api.run(() => { const r = addClip(lib, { filmId: film.id, start: st, end: en, bufBefore: before, bufAfter: after, title, category: category || null }, realCtx()); made = r.clip; return r.changes; });
    if (err || !made) { onError(err ?? 'Not added'); return; }
    setStart(''); setEnd(''); setTitle('');
    onAdded(made);
  }

  return (
    <form className={s.addForm} onSubmit={e => { e.preventDefault(); add(); }}>
      <div className={s.timeRow}>
        <label className={s.label} htmlFor="start">Start</label>
        <input id="start" className={s.input} value={start} onChange={e => setStart(e.target.value)} placeholder="0:00" inputMode="decimal" />
        <button type="button" className={s.ghost} onClick={() => capture(setStart)}>↓ Now</button>
      </div>
      <div className={s.timeRow}>
        <label className={s.label} htmlFor="end">End</label>
        <input id="end" className={s.input} value={end} onChange={e => setEnd(e.target.value)} placeholder="blank = 5s" inputMode="decimal" />
        <button type="button" className={s.ghost} onClick={() => capture(setEnd)}>↓ Now</button>
      </div>
      <div className={s.bufRow}>
        <label className={s.label}>Before <input type="range" min={0} max={15} step={0.5} value={before} onChange={e => setBefore(Number(e.target.value))} /> <span>{before}s</span></label>
        <label className={s.label}>After <input type="range" min={0} max={15} step={0.5} value={after} onChange={e => setAfter(Number(e.target.value))} /> <span>{after}s</span></label>
      </div>
      <input className={s.input} value={title} onChange={e => setTitle(e.target.value)} placeholder={`Label (e.g. ${sport(sportId).labelPlaceholder})`} aria-label="Clip label" maxLength={200} />
      <select className={s.select} value={category} onChange={e => setCategory(e.target.value)} aria-label="Category">
        {film.categories.length ? film.categories.map(k => <option key={k.name} value={k.name}>{k.emoji} {k.name}</option>) : <option value="">No categories yet</option>}
      </select>
      <button className={s.button}>+ Add clip</button>
    </form>
  );
}

/* ── Edit a clip: times, category, and the new notes / tags / credit ──────── */

function ClipEditor({ api, lib, clip, videoTitle, onDone, onError }: {
  api: LibraryApi; lib: LocalLibrary; clip: Clip; videoTitle: (() => { title: string | null; author: string | null }) | null;
  onDone: (msg: string) => void; onError: (e: string) => void;
}) {
  const film = lib.films.find(f => f.id === clip.filmId);
  const buf = buffers(clip);
  const [v, setV] = useState({
    title: clip.title,
    start: clock(clip.markedStartSeconds ?? clip.startSeconds), end: clock(clip.markedEndSeconds ?? clip.endSeconds),
    before: buf.before, after: buf.after, category: clip.category ?? '',
    notes: clip.notes, points: clip.coachingPoints.join('\n'), tags: clip.tags.join(', '),
    coachName: clip.credit.coachName ?? '', coachUrl: clip.credit.url ?? '', sourceTitle: clip.credit.sourceTitle ?? '',
    channelName: clip.credit.channelName ?? '', channelUrl: clip.credit.channelUrl ?? '',
  });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV(o => ({ ...o, [k]: e.target.value }));
  const https = (u: string) => (u.trim() ? (/^https:\/\/\S+$/.test(u.trim()) ? u.trim() : undefined) : null);

  async function save() {
    const start = parseClock(v.start), end = parseClock(v.end);
    if (start === null || end === null) { onError('Times look like 1:49'); return; }
    const coachUrl = https(v.coachUrl), channelUrl = https(v.channelUrl);
    if (coachUrl === undefined || channelUrl === undefined) { onError('Links must start with https://'); return; }
    const err = await api.run(() => updateClip(lib, clip.id, {
      title: v.title, start, end, bufBefore: Number(v.before), bufAfter: Number(v.after),
      category: v.category || undefined, notes: v.notes, coachingPoints: parseLines(v.points), tags: parseTags(v.tags),
      credit: { coachName: v.coachName.trim() || null, url: coachUrl, sourceTitle: v.sourceTitle.trim() || null, channelName: v.channelName.trim() || null, channelUrl },
    }, realCtx()));
    if (err) onError(err); else onDone('Saved.');
  }

  async function remove() {
    if (!confirm(`Delete "${clip.title}"?`)) return;
    const err = await api.run(() => deleteClips([clip.id]));
    if (err) onError(err); else onDone('Clip deleted.');
  }

  function fill() {
    const d = videoTitle?.();
    if (!d?.title) { onError('Play this clip first, so the video can tell us its title'); return; }
    setV(o => ({ ...o, sourceTitle: d.title ?? o.sourceTitle, channelName: d.author ?? o.channelName }));
  }

  return (
    <form className={s.editor} onSubmit={e => { e.preventDefault(); save(); }}>
      <label className={s.field}><span className={s.label}>Title</span><input className={s.input} value={v.title} onChange={set('title')} maxLength={200} /></label>
      <div className={s.pair}>
        <label className={s.field}><span className={s.label}>Start</span><input className={s.input} value={v.start} onChange={set('start')} inputMode="decimal" /></label>
        <label className={s.field}><span className={s.label}>End</span><input className={s.input} value={v.end} onChange={set('end')} inputMode="decimal" /></label>
      </div>
      <div className={s.bufRow}>
        <label className={s.label}>Before <input type="range" min={0} max={15} step={0.5} value={v.before} onChange={set('before')} /> <span>{v.before}s</span></label>
        <label className={s.label}>After <input type="range" min={0} max={15} step={0.5} value={v.after} onChange={set('after')} /> <span>{v.after}s</span></label>
      </div>
      <label className={s.field}><span className={s.label}>Category</span>
        <select className={s.select} value={v.category} onChange={set('category')}>
          {(film?.categories ?? []).map(k => <option key={k.name} value={k.name}>{k.emoji} {k.name}</option>)}
        </select>
      </label>
      <label className={s.field}><span className={s.label}>Notes</span><textarea className={s.textarea} value={v.notes} onChange={set('notes')} rows={3} /></label>
      <label className={s.field}><span className={s.label}>Coaching points · one per line</span><textarea className={s.textarea} value={v.points} onChange={set('points')} rows={2} /></label>
      <label className={s.field}><span className={s.label}>Tags · separated by commas</span><input className={s.input} value={v.tags} onChange={set('tags')} /></label>
      <details>
        <summary className={s.label}>Credit</summary>
        <div className={s.stack}>
          <div className={s.pair}>
            <input className={s.input} value={v.coachName} onChange={set('coachName')} placeholder="Coach" aria-label="Coach" />
            <input className={s.input} value={v.coachUrl} onChange={set('coachUrl')} placeholder="Coach’s link (https://…)" aria-label="Coach’s link" inputMode="url" />
          </div>
          <input className={s.input} value={v.sourceTitle} onChange={set('sourceTitle')} placeholder="Video title" aria-label="Video title" />
          <div className={s.pair}>
            <input className={s.input} value={v.channelName} onChange={set('channelName')} placeholder="Channel" aria-label="Channel" />
            <input className={s.input} value={v.channelUrl} onChange={set('channelUrl')} placeholder="Channel link (https://…)" aria-label="Channel link" inputMode="url" />
          </div>
          <button type="button" className={s.ghost} onClick={fill}>Fill title and channel from the video</button>
        </div>
      </details>
      <div className={s.row}>
        <button className={s.button}>Save</button>
        <button type="button" className={s.danger} onClick={remove}>Delete clip</button>
      </div>
    </form>
  );
}

/* ── A film's categories (classic playlists sidebar) ─────────────────────── */

function Categories({ api, lib, filmId, sel, setSel, sportId, say }: {
  api: LibraryApi; lib: LocalLibrary; filmId: string; sel: Selection; setSel: (s: Selection) => void; sportId?: string;
  say: (err: string | null, ok?: string) => void;
}) {
  const film = lib.films.find(f => f.id === filmId)!;
  const counts = new Map<string, number>();
  for (const c of filmClips(lib, filmId)) counts.set(c.category ?? '', (counts.get(c.category ?? '') ?? 0) + 1);
  const total = filmClips(lib, filmId).length;
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const choices = emojiChoices(sportId);
  const [emoji, setEmoji] = useState(choices[0]!);
  const isOn = (cat: string | null) => sel.kind === 'film' && sel.filmId === filmId && sel.category === cat;

  async function add() {
    const err = await api.run(() => addCategory(lib, filmId, name, emoji, realCtx()));
    if (err) { say(err); return; }
    setName(''); setAdding(false); say(null, 'Category added');
  }

  return (
    <div className={s.stack}>
      <ul className={s.catList}>
        <li><button className={isOn(null) ? s.catOn : ''} onClick={() => setSel({ kind: 'film', filmId, category: null })}>📋 All clips <span className={s.muted}>{plural(total, 'clip')}</span></button></li>
        {film.categories.map(k => (
          <li key={k.name}>
            <button className={isOn(k.name) ? s.catOn : ''} onClick={() => setSel({ kind: 'film', filmId, category: k.name })}>
              {k.emoji} {k.name} <span className={s.muted}>{counts.get(k.name) ?? 0}</span>
            </button>
            <button className={s.small} aria-label={`Rename ${k.name}`} onClick={async () => {
              const n = prompt('Rename category', k.name);
              if (n === null) return;
              const err = await api.run(() => renameCategory(lib, filmId, k.name, n, realCtx()));
              say(err);
              if (!err && isOn(k.name)) setSel({ kind: 'film', filmId, category: n.trim() });
            }} title="Rename">✎</button>
            <button className={s.small} aria-label={`Delete ${k.name}`} title="Delete" onClick={async () => {
              const held = counts.get(k.name) ?? 0;
              if (!confirm(held ? `Delete "${k.name}"? Its ${plural(held, 'clip')} move to General in this film.` : `Delete "${k.name}"?`)) return;
              say(await api.run(() => deleteCategory(lib, filmId, k.name, realCtx())));
              if (isOn(k.name)) setSel({ kind: 'film', filmId, category: null });
            }}>✕</button>
          </li>
        ))}
      </ul>
      {adding ? (
        <form className={s.stack} onSubmit={e => { e.preventDefault(); add(); }}>
          <input className={s.input} value={name} onChange={e => setName(e.target.value)} placeholder="Category name" maxLength={40} autoFocus aria-label="Category name" />
          <div className={s.emojiRow} role="radiogroup" aria-label="Emoji">
            {choices.map(e => <button type="button" key={e} role="radio" aria-checked={emoji === e} className={emoji === e ? s.emojiOn : ''} onClick={() => setEmoji(e)}>{e}</button>)}
          </div>
          <div className={s.row}><button className={s.button}>Create</button><button type="button" className={s.ghost} onClick={() => setAdding(false)}>Cancel</button></div>
        </form>
      ) : <button className={s.ghost} onClick={() => setAdding(true)}>+ New category</button>}
    </div>
  );
}
