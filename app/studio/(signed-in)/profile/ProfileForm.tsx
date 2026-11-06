'use client';

import { startTransition, useActionState } from 'react';
import { saveProfile, type FormState } from '../../actions';
import styles from '../../studio.module.css';

type Values = { displayName: string; handle: string; tagline: string; bio: string; links: string };

export function ProfileForm({ initial }: { initial: Values }) {
  const [state, action, saving] = useActionState<FormState, FormData>(saveProfile, { ok: false, message: '' });
  return (
    // Submitted by hand, like the clip editor, so React doesn't reset the fields after saving
    <form className={styles.panel}
          onSubmit={e => { e.preventDefault(); const d = new FormData(e.currentTarget); startTransition(() => action(d)); }}>
      <div className={`${styles.pair} ${styles.wrap}`}>
        <div className={styles.field}>
          <label htmlFor="displayName">Name</label>
          <input id="displayName" name="displayName" className={styles.input} defaultValue={initial.displayName} required maxLength={100} />
        </div>
        <div className={styles.field}>
          <label htmlFor="handle">Handle</label>
          <input id="handle" name="handle" className={styles.input} defaultValue={initial.handle} required
                 pattern="[a-z0-9\-]{3,30}" autoCapitalize="off" spellCheck={false} placeholder="hamish" />
        </div>
      </div>
      <div className={styles.field}>
        <label htmlFor="tagline">Tagline</label>
        <input id="tagline" name="tagline" className={styles.input} defaultValue={initial.tagline} maxLength={200}
               placeholder="Basketball coach. Writing Beyond The Arc." />
        <span className={styles.hint}>One line, under your name on the home page and in link previews.</span>
      </div>
      <div className={styles.field}>
        <label htmlFor="bio">About</label>
        <textarea id="bio" name="bio" className={styles.textarea} defaultValue={initial.bio} rows={8} maxLength={10000} />
        <span className={styles.hint}>Plain text. A blank line starts a new paragraph; links become clickable.</span>
      </div>
      <div className={styles.field}>
        <label htmlFor="links">Links</label>
        <textarea id="links" name="links" className={styles.textarea} defaultValue={initial.links} rows={3}
                  placeholder={'Instagram | https://instagram.com/…\nYouTube | https://youtube.com/@…'} />
        <span className={styles.hint}>One per line, as “Label | https://…”.</span>
      </div>
      <div className={styles.row}>
        <button className={styles.button} disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</button>
        {state.message && <span role="status" className={`${styles.status} ${state.ok ? styles.ok : styles.bad}`}>{state.message}</span>}
      </div>
    </form>
  );
}
