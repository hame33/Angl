'use client';

import Link from 'next/link';
import { useState } from 'react';
import { createFilm, createTeam, deleteFilm, deleteTeam, realCtx, renameTeam, setTeamSport } from '@/lib/filmroom/ops';
import { SPORTS } from '@/lib/filmroom/sports';
import { categoryRollup, filmClips, fmtDuration, recentClips, stats, teamFilms, type Selection } from '@/lib/filmroom/view';
import type { ClassicStatus } from '@/lib/local/classic-sync';
import type { Clip, LocalLibrary } from '@/lib/model/types';
import { clock } from '@/lib/text';
import { parseVideoUrl } from '@/lib/youtube';
import type { LibraryApi } from './useLibrary';
import s from './film-room.module.css';

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
export type Notice = { tone: 'ok' | 'bad' | 'info'; text: string } | null;

interface Props {
  api: LibraryApi;
  lib: LocalLibrary;
  teamId: string | null;
  setTeamId: (id: string | null) => void;
  open: (sel: Selection, playClip?: Clip) => void;
  notice: Notice;
  setNotice: (n: Notice) => void;
  onExport: () => void;
  onImport: (f: File) => void;
  busy: boolean;
}

/* The film room's home: classic Angl's dashboard (renderDashboard), team by team. */
export function Dashboard({ api, lib, teamId, setTeamId, open, notice, setNotice, onExport, onImport, busy }: Props) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [addingTeam, setAddingTeam] = useState(false);
  const [teamName, setTeamName] = useState('');
  const [teamSport, setTeamSportState] = useState('basketball');

  const team = lib.teams.find(t => t.id === teamId) ?? null;
  const films = teamFilms(lib, teamId);
  const st = stats(lib, teamId);
  const cats = categoryRollup(lib, teamId);
  const maxCat = Math.max(1, ...cats.map(c => c.count));
  const recent = recentClips(lib, teamId);
  const classic: ClassicStatus | null = api.classic;
  const say = (msg: string | null, ok: string) => setNotice(msg ? { tone: 'bad', text: msg } : { tone: 'ok', text: ok });

  async function addFilm() {
    const vid = parseVideoUrl(url);
    if (!vid) { setNotice({ tone: 'bad', text: 'Couldn’t find a YouTube video in that link.' }); return; }
    let result: ReturnType<typeof createFilm> | null = null;
    const err = await api.run(() => { result = createFilm(lib, { videoId: vid, title, teamId }, realCtx()); return result.changes; });
    if (err || !result) { say(err, ''); return; }
    const r = result as ReturnType<typeof createFilm>;
    setUrl(''); setTitle('');
    if (r.film.teamId) setTeamId(r.film.teamId);
    setNotice(r.existing ? { tone: 'info', text: `Already saved as “${r.film.title}”.` } : null);
    open({ kind: 'film', filmId: r.film.id, category: null });
  }

  async function addTeam() {
    let id = '';
    const err = await api.run(() => { const r = createTeam(lib, teamName, teamSport, realCtx()); id = r.team.id; return r.changes; });
    if (err) { say(err, ''); return; }
    setAddingTeam(false); setTeamName('');
    setTeamId(id);
    setNotice({ tone: 'ok', text: 'Team added.' });
  }

  async function removeTeam() {
    if (!team) return;
    const fs = films.length, cs = st.clips;
    if (!confirm(`Delete "${team.name}", its ${plural(fs, 'film')} and ${plural(cs, 'clip')}?\n\nThis can’t be undone.`)) return;
    const err = await api.run(() => deleteTeam(lib, team.id));
    say(err, `Deleted ${team.name}.`);
    setTeamId(lib.teams.find(t => t.id !== team.id)?.id ?? null);
  }

  async function removeFilm(filmId: string, name: string) {
    const n = filmClips(lib, filmId).length;
    if (!confirm(`Delete "${name}" and its ${plural(n, 'clip')}?\n\nThis can’t be undone.`)) return;
    say(await api.run(() => deleteFilm(lib, filmId)), `Deleted ${name}.`);
  }

  return (
    <main className={s.stack}>
      <div className={s.dashHead}>
        <div>
          <h1 className={s.h1}>Film room</h1>
          <p className={s.muted}>Kept in this browser. Publish clips from the <Link href="/studio">studio</Link>.</p>
        </div>
        <div className={s.teamBar}>
          <label className={s.srOnly} htmlFor="team">Team</label>
          <select id="team" className={s.select} value={teamId ?? ''} onChange={e => setTeamId(e.target.value || null)}>
            {lib.teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            {lib.teams.length > 1 && <option value="">All teams</option>}
            {!lib.teams.length && <option value="">No teams yet</option>}
          </select>
          <button className={s.ghost} onClick={() => setAddingTeam(a => !a)}>{addingTeam ? 'Cancel' : 'New team'}</button>
        </div>
      </div>

      {addingTeam && (
        <form className={s.panel} onSubmit={e => { e.preventDefault(); addTeam(); }}>
          <div className={s.pair}>
            <input className={s.input} value={teamName} onChange={e => setTeamName(e.target.value)} placeholder="Team or year, e.g. U16 Girls 2026" maxLength={60} autoFocus />
            <select className={s.select} value={teamSport} onChange={e => setTeamSportState(e.target.value)}>
              {Object.values(SPORTS).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <button className={s.button}>Create team</button>
        </form>
      )}

      {team && (
        <details className={s.teamTools}>
          <summary className={s.muted}>Team settings</summary>
          <div className={s.row}>
            <button className={s.ghost} onClick={async () => { const n = prompt('Rename team', team.name); if (n !== null) say(await api.run(() => renameTeam(lib, team.id, n, realCtx())), 'Renamed.'); }}>Rename</button>
            <select className={s.select} value={team.sport} aria-label="Sport"
                    onChange={async e => say(await api.run(() => setTeamSport(lib, team.id, e.target.value, realCtx())), `${team.name} is now ${SPORTS[e.target.value]?.name}. New films use its categories.`)}>
              {Object.values(SPORTS).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button className={s.danger} onClick={removeTeam}>Delete team</button>
          </div>
        </details>
      )}

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
          <button className={s.button} disabled={busy}
                  onClick={async () => { const n = await api.bringIn(); setNotice({ tone: 'ok', text: `Brought in ${plural(n, 'clip')} from classic Angl.` }); }}>
            Bring {classic.added.clips.length === 1 ? 'it' : 'them'} in
          </button>
        </div>
      )}
      {classic && 'damaged' in classic && classic.damaged.length > 0 && (
        <p className={`${s.notice} ${s.bad}`} role="alert">
          Part of the classic library couldn’t be read ({classic.damaged.join(', ')}). Everything else came across; classic Angl still has its copy.
        </p>
      )}
      {api.failure && <p className={`${s.notice} ${s.bad}`} role="alert">{api.failure}</p>}
      {notice && <p className={`${s.notice} ${s[notice.tone]}`} role="status">{notice.text}</p>}

      <div className={s.stats}>
        {([['Films', st.films], ['Clips', st.clips], ['Categories', st.categories], ['Footage', fmtDuration(st.seconds)]] as const).map(([k, v]) => (
          <div key={k} className={s.stat}><div className={s.statVal}>{v}</div><div className={s.statLabel}>{k}</div></div>
        ))}
      </div>

      <form className={s.panel} onSubmit={e => { e.preventDefault(); addFilm(); }}>
        <h2 className={s.h2}>Add a film</h2>
        <input className={s.input} value={url} onChange={e => setUrl(e.target.value)} placeholder="Paste a YouTube link…" inputMode="url" autoCapitalize="off" spellCheck={false} aria-label="YouTube link" />
        <input className={s.input} value={title} onChange={e => setTitle(e.target.value)} placeholder="Title (optional — taken from the video)" aria-label="Film title" />
        <button className={s.button} disabled={!url.trim()}>Add film</button>
      </form>

      <section>
        <h2 className={s.h2}>Films · {films.length}</h2>
        {films.length ? (
          <ul className={s.films}>
            {films.map(f => {
              const clips = filmClips(lib, f.id);
              return (
                <li key={f.id} className={s.filmCard}>
                  <button className={s.filmOpen} onClick={() => open({ kind: 'film', filmId: f.id, category: null })}>
                    {f.video.videoId && <img src={`https://i.ytimg.com/vi/${f.video.videoId}/mqdefault.jpg`} alt="" width={320} height={180} loading="lazy" />}
                    <span className={s.filmTitle}>{f.title}</span>
                    <span className={s.muted}>{plural(clips.length, 'clip')}{teamId === null ? ` · ${lib.teams.find(t => t.id === f.teamId)?.name ?? ''}` : ''}</span>
                  </button>
                  <div className={s.chips}>
                    {f.categories.map(k => {
                      const n = clips.filter(c => c.category === k.name).length;
                      return (
                        <button key={k.name} className={`${s.chip} ${n ? '' : s.chipMuted}`} onClick={() => open({ kind: 'film', filmId: f.id, category: k.name })}>
                          {k.emoji} {k.name}{n ? ` · ${n}` : ''}
                        </button>
                      );
                    })}
                  </div>
                  <button className={s.linkDanger} onClick={() => removeFilm(f.id, f.title)}>Delete film</button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className={s.muted}>No films yet. Paste a YouTube link above{lib.clips.length ? '' : ', or import an Angl export below'}.</p>
        )}
      </section>

      {cats.length > 0 && (
        <section>
          <h2 className={s.h2}>Categories · across every film</h2>
          <ul className={s.cats}>
            {cats.map(c => (
              <li key={c.name}>
                <button className={s.catRow} onClick={() => open({ kind: 'category', name: c.name, teamId })}>
                  <span>{c.emoji} {c.name}</span>
                  <span className={s.catBar}><span style={{ width: `${Math.round((c.count / maxCat) * 100)}%` }} /></span>
                  <span className={s.muted}>{c.count} · {plural(c.films, 'film')} · {fmtDuration(c.seconds)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {recent.length > 0 && (
        <section>
          <h2 className={s.h2}>Recent clips</h2>
          <ul className={s.recent}>
            {recent.map(c => (
              <li key={c.id}>
                <button onClick={() => c.filmId && open({ kind: 'film', filmId: c.filmId, category: null }, c)}>
                  <span>{c.title}</span>
                  <span className={s.muted}>{lib.films.find(f => f.id === c.filmId)?.title ?? 'Unknown film'} · {clock(c.startSeconds)}–{clock(c.endSeconds)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={s.row}>
        <button className={s.ghost} onClick={onExport} disabled={busy || !lib.clips.length}>Export library</button>
        <label className={s.ghost}>
          Import a file
          <input type="file" accept=".json,application/json" hidden disabled={busy}
                 onChange={e => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = ''; }} />
        </label>
      </section>
      {!lib.films.length && (
        <p className={s.muted}>
          Using classic Angl on this computer? Serve this site with <code>npm run local</code> and open
          <code> http://localhost:8777/film-room</code>: your classic library comes across by itself.
        </p>
      )}
    </main>
  );
}
