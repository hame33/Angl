import Link from 'next/link';
import { currentPublisher } from '@/lib/supabase/server';
import { groupStudioClips, listMyClips, type StudioClip } from '@/lib/studio-clips';
import { clock } from '@/lib/text';
import { ImportPanel } from './ImportPanel';
import styles from '../studio.module.css';

export const dynamic = 'force-dynamic';

function ClipRow({ c }: { c: StudioClip }) {
  return (
    <li>
      <Link href={`/studio/clips/${c.id}`} className={styles.clip}>
        <span>
          <span className={styles.clipTitle}>{c.title}</span>
          <span className={styles.clipMeta}> · {clock(c.start_seconds)}–{clock(c.end_seconds)}{c.youtube_video_id ? '' : ' · no film'}</span>
        </span>
        {c.visibility !== 'private' && <span className={`${styles.badge} ${styles[c.visibility]}`}>{c.visibility}</span>}
      </Link>
    </li>
  );
}

export default async function StudioHome() {
  // Layouts and pages render in parallel, so the layout's redirect doesn't stop
  // this from running: guard here too, and leave the explaining to the layout.
  const { user, isPublisher } = await currentPublisher();
  if (!user || !isPublisher) return null;
  const clips = await listMyClips(user.id);
  const shared = clips.filter(c => c.visibility !== 'private');
  const groups = groupStudioClips(clips);

  return (
    <main className={styles.stack}>
      <h1 className={styles.h1}>Studio</h1>

      <ImportPanel />

      <section className={styles.stack} style={{ gap: 10 }}>
        <h2 className={styles.h2}>Shared · {shared.length}</h2>
        {shared.length
          ? <ul className={styles.list}>{shared.map(c => <ClipRow key={c.id} c={c} />)}</ul>
          : <p className={styles.muted}>Nothing shared yet. Open a clip below, add your notes, and make it public.</p>}
      </section>

      <section className={styles.stack} style={{ gap: 10 }}>
        <h2 className={styles.h2}>Library · {clips.length} clip{clips.length === 1 ? '' : 's'}</h2>
        {groups.map(g => (
          <details key={g.key} className={styles.group}>
            <summary><span>{g.film} <span className={styles.muted}>· {g.team}</span></span><span className={styles.muted}>{g.count}</span></summary>
            {g.categories.map(cat => (
              <div key={cat.name}>
                <div className={styles.cat}>{cat.emoji ? `${cat.emoji} ` : ''}{cat.name} · {cat.clips.length}</div>
                <ul className={styles.list}>{cat.clips.map(c => <ClipRow key={c.id} c={c} />)}</ul>
              </div>
            ))}
          </details>
        ))}
      </section>
    </main>
  );
}
