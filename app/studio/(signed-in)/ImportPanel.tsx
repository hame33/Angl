'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { IMPORT_BATCH } from '@/lib/clip-form';
import { convertLibrary, groupClips, type Conversion } from '@/lib/legacy/convert';
import { libraryFromExport } from '@/lib/legacy/migrate';
import { importClips } from '../actions';
import styles from '../studio.module.css';

/*
 * Reads an Angl export (angl-clips.json, versions 1–4) in the browser, shows
 * what is in it, then sends the clips up in batches as private. Nothing is
 * published by importing; you choose what to share clip by clip.
 *
 * The file never leaves this page except as those clip rows: the dictation
 * log, settings and duration model it also carries are not uploaded.
 */
export function ImportPanel() {
  const router = useRouter();
  const [conv, setConv] = useState<Conversion | null>(null);
  const [fileName, setFileName] = useState('');
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function read(file: File) {
    setStatus(null); setConv(null); setFileName(file.name);
    let data: unknown;
    try { data = JSON.parse(await file.text()); } catch {
      setStatus({ ok: false, text: 'That file isn’t valid JSON. Use the Export button in classic Angl.' }); return;
    }
    const lib = libraryFromExport(data);
    if (!lib) { setStatus({ ok: false, text: 'That isn’t an Angl export: it has no clips, games or playlists.' }); return; }
    const c = convertLibrary(lib);
    if (!c.clips.length) { setStatus({ ok: false, text: 'That export has no clips that can be imported.' }); return; }
    setConv(c);
  }

  async function upload() {
    if (!conv) return;
    setBusy(true);
    let added = 0, existing = 0;
    for (let i = 0; i < conv.clips.length; i += IMPORT_BATCH) {
      setStatus({ ok: true, text: `Importing… ${Math.min(i + IMPORT_BATCH, conv.clips.length)} of ${conv.clips.length}` });
      const r = await importClips(conv.clips.slice(i, i + IMPORT_BATCH));
      if (!r.ok) { setStatus({ ok: false, text: r.message + (added ? ` (${added} were added before it stopped.)` : '') }); setBusy(false); router.refresh(); return; }
      added += r.added; existing += r.existing;
    }
    setBusy(false);
    setConv(null);
    setStatus({ ok: true, text: `Added ${added} clip${added === 1 ? '' : 's'}` + (existing ? `; ${existing} ${existing === 1 ? 'was' : 'were'} already here and left as they are.` : '.') });
    router.refresh();
  }

  const groups = conv ? groupClips(conv.clips) : [];
  return (
    <section className={styles.panel}>
      <h2 className={styles.h2}>Import from classic Angl</h2>
      <p className={styles.muted}>
        In classic Angl, press Export to save <code>angl-clips.json</code>, then choose it here.
        Clips come in private; importing the same file again adds only what’s new.
      </p>
      <input type="file" accept=".json,application/json" className={styles.input}
             onChange={e => { const f = e.target.files?.[0]; if (f) read(f); e.target.value = ''; }} disabled={busy} />

      {conv && (
        <div className={styles.stack} style={{ gap: 10 }}>
          <p><strong>{fileName}</strong>: {conv.clips.length} clip{conv.clips.length === 1 ? '' : 's'}
            {conv.skipped.length ? `, ${conv.skipped.length} skipped` : ''}</p>
          <div className={styles.tree}>
            {groups.map(t => (
              <div key={t.team}>
                <strong>{t.team}</strong> · {t.count}
                <ul>{t.films.map(f => (
                  <li key={f.key}>{f.film} · {f.count}
                    <ul>{f.categories.map(k => <li key={k.category} className={styles.muted}>{k.category} · {k.count}</li>)}</ul>
                  </li>
                ))}</ul>
              </div>
            ))}
          </div>
          {conv.skipped.length > 0 && (
            <details>
              <summary className={styles.muted}>Why {conv.skipped.length} {conv.skipped.length === 1 ? 'was' : 'were'} skipped</summary>
              <ul className={styles.tree}>{conv.skipped.slice(0, 50).map(s => <li key={s.index}>{s.label}: {s.reason}</li>)}</ul>
            </details>
          )}
          <div className={styles.row}>
            <button className={styles.button} onClick={upload} disabled={busy}>
              {busy ? 'Importing…' : `Import ${conv.clips.length} clip${conv.clips.length === 1 ? '' : 's'} as private`}
            </button>
            <button className={styles.ghost} onClick={() => { setConv(null); setStatus(null); }} disabled={busy}>Cancel</button>
          </div>
        </div>
      )}
      {status && <p role="status" className={`${styles.status} ${status.ok ? styles.ok : styles.bad}`}>{status.text}</p>}
    </section>
  );
}
