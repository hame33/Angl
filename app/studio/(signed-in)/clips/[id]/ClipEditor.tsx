'use client';

import { startTransition, useActionState, useRef, useState, useTransition } from 'react';
import { clock } from '@/lib/text';
import { fillFromYouTube, saveClip, type FormState } from '../../../actions';
import styles from '../../../studio.module.css';

export interface EditableClip {
  id: string;
  share_id: string;
  title: string;
  notes: string;
  coaching_points: string[];
  tags: string[];
  youtube_video_id: string | null;
  start_seconds: number;
  end_seconds: number;
  credit_coach_name: string | null;
  credit_url: string | null;
  credit_source_title: string | null;
  source_channel_name: string | null;
  source_channel_url: string | null;
  visibility: 'private' | 'unlisted' | 'public';
}

const VISIBILITY = [
  { value: 'private', label: 'Private — only you' },
  { value: 'unlisted', label: 'Unlisted — anyone with the link' },
  { value: 'public', label: 'Public — listed on the site' },
];

export function ClipEditor({ clip, initialPath }: { clip: EditableClip; initialPath: string | null }) {
  const [state, action, saving] = useActionState<FormState, FormData>(saveClip, { ok: false, message: '' });
  const [filling, startFill] = useTransition();
  const [fillNote, setFillNote] = useState('');
  const form = useRef<HTMLFormElement>(null);

  const path = state.ok ? state.shareUrl ?? null : initialPath;
  const [copied, setCopied] = useState(false);

  function set(name: string, value: string | null) {
    const el = form.current?.elements.namedItem(name) as HTMLInputElement | null;
    if (el && value) el.value = value;
  }

  function fill() {
    const videoId = (form.current?.elements.namedItem('videoId') as HTMLInputElement | null)?.value.trim();
    if (!videoId) { setFillNote('Add the YouTube video id first.'); return; }
    startFill(async () => {
      const info = await fillFromYouTube(videoId);
      if (!info) { setFillNote('YouTube didn’t answer for that video. It may be private, removed or not embeddable.'); return; }
      set('sourceTitle', info.sourceTitle);
      set('channelName', info.channelName);
      set('channelUrl', info.channelUrl);
      setFillNote('Filled the video title and channel. The coach is up to you.');
    });
  }

  async function copy() {
    if (!path) return;
    try { await navigator.clipboard.writeText(new URL(path, location.origin).toString()); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* no clipboard: the link is still on screen */ }
  }

  return (
    // Submitted by hand rather than with <form action>: React 19 resets a form's
    // fields after a form action, back to the values the page loaded with — the
    // ones from before this save — and the next save would write them back.
    <form ref={form} className={styles.stack}
          onSubmit={e => { e.preventDefault(); const data = new FormData(e.currentTarget); startTransition(() => action(data)); }}>
      <input type="hidden" name="id" value={clip.id} />

      <div className={styles.panel}>
        <div className={styles.field}>
          <label htmlFor="title">Title</label>
          <input id="title" name="title" className={styles.input} defaultValue={clip.title} required maxLength={200} />
        </div>
        <div className={styles.field}>
          <label htmlFor="notes">Notes</label>
          <textarea id="notes" name="notes" className={styles.textarea} defaultValue={clip.notes} rows={5} maxLength={20000} />
          <span className={styles.hint}>Plain text. A blank line starts a new paragraph; links become clickable.</span>
        </div>
        <div className={styles.field}>
          <label htmlFor="coachingPoints">Coaching points</label>
          <textarea id="coachingPoints" name="coachingPoints" className={styles.textarea} rows={3}
                    defaultValue={clip.coaching_points.join('\n')} />
          <span className={styles.hint}>One per line.</span>
        </div>
        <div className={styles.field}>
          <label htmlFor="tags">Tags</label>
          <input id="tags" name="tags" className={styles.input} defaultValue={clip.tags.join(', ')} placeholder="transition, finishing" />
          <span className={styles.hint}>Separated by commas.</span>
        </div>
      </div>

      <div className={styles.panel}>
        <div className={styles.field}>
          <label htmlFor="videoId">YouTube video id</label>
          <input id="videoId" name="videoId" className={styles.input} defaultValue={clip.youtube_video_id ?? ''}
                 spellCheck={false} autoCapitalize="off" placeholder="bJJy8l6tVAI" />
        </div>
        <div className={styles.pair}>
          <div className={styles.field}>
            <label htmlFor="start">Start</label>
            <input id="start" name="start" className={styles.input} defaultValue={clock(clip.start_seconds)} inputMode="decimal" required />
          </div>
          <div className={styles.field}>
            <label htmlFor="end">End</label>
            <input id="end" name="end" className={styles.input} defaultValue={clock(clip.end_seconds)} inputMode="decimal" required />
          </div>
        </div>
        <span className={styles.hint}>The range that plays, like 1:49 and 2:23.</span>
      </div>

      <div className={styles.panel}>
        <h2 className={styles.h2}>Credit</h2>
        <div className={`${styles.pair} ${styles.wrap}`}>
          <div className={styles.field}>
            <label htmlFor="coachName">Coach</label>
            <input id="coachName" name="coachName" className={styles.input} defaultValue={clip.credit_coach_name ?? ''} placeholder="John Calipari" />
          </div>
          <div className={styles.field}>
            <label htmlFor="coachUrl">Coach’s link</label>
            <input id="coachUrl" name="coachUrl" className={styles.input} defaultValue={clip.credit_url ?? ''} placeholder="https://…" inputMode="url" />
          </div>
        </div>
        <div className={styles.field}>
          <label htmlFor="sourceTitle">Video title</label>
          <input id="sourceTitle" name="sourceTitle" className={styles.input} defaultValue={clip.credit_source_title ?? ''} />
        </div>
        <div className={`${styles.pair} ${styles.wrap}`}>
          <div className={styles.field}>
            <label htmlFor="channelName">Channel</label>
            <input id="channelName" name="channelName" className={styles.input} defaultValue={clip.source_channel_name ?? ''} />
          </div>
          <div className={styles.field}>
            <label htmlFor="channelUrl">Channel link</label>
            <input id="channelUrl" name="channelUrl" className={styles.input} defaultValue={clip.source_channel_url ?? ''} inputMode="url" />
          </div>
        </div>
        <div className={styles.row}>
          <button type="button" className={styles.ghost} onClick={fill} disabled={filling}>
            {filling ? 'Asking YouTube…' : 'Fill video title and channel from YouTube'}
          </button>
          {fillNote && <span className={styles.hint}>{fillNote}</span>}
        </div>
      </div>

      <div className={styles.panel}>
        <div className={styles.field}>
          <label htmlFor="visibility">Who can see it</label>
          <select id="visibility" name="visibility" className={styles.select} defaultValue={clip.visibility}>
            {VISIBILITY.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
          </select>
        </div>
        <div className={styles.row}>
          <button className={styles.button} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          {state.message && <span role="status" className={`${styles.status} ${state.ok ? styles.ok : styles.bad}`}>{state.message}</span>}
        </div>
        {path && (
          <div className={styles.row}>
            <a href={path} target="_blank" rel="noopener">Open the share page</a>
            <button type="button" className={styles.ghost} onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
          </div>
        )}
      </div>
    </form>
  );
}
