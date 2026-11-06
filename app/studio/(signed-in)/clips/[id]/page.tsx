import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient, currentPublisher } from '@/lib/supabase/server';
import { slugify } from '@/lib/text';
import { ClipEditor, type EditableClip } from './ClipEditor';
import styles from '../../../studio.module.css';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditClipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { isPublisher } = await currentPublisher();
  if (!isPublisher) return null;   // the layout redirects or explains
  const supabase = await createClient();
  const { data } = await supabase.from('clips').select(
    'id, share_id, title, notes, coaching_points, tags, youtube_video_id, start_seconds, end_seconds, ' +
    'credit_coach_name, credit_url, credit_source_title, source_channel_name, source_channel_url, visibility, category, legacy',
  ).eq('id', id).maybeSingle();
  if (!data) notFound();
  const c = data as unknown as EditableClip & { category: string | null; legacy: { gameTitle?: string; teamName?: string } | null };

  return (
    <main className={styles.stack}>
      <p><Link href="/studio">← All clips</Link></p>
      <div>
        <h1 className={styles.h1}>{c.title}</h1>
        <p className={styles.muted}>
          {[c.legacy?.teamName, c.legacy?.gameTitle, c.category].filter(Boolean).join(' · ') || 'Added in the studio'}
        </p>
      </div>
      <ClipEditor clip={c} initialPath={c.visibility === 'private' ? null : `/clips/${c.share_id}/${slugify(c.title)}`} />
    </main>
  );
}
