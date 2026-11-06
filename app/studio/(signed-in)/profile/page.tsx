import Link from 'next/link';
import { createClient, currentPublisher } from '@/lib/supabase/server';
import { linksToText, parseLinks } from '@/lib/profile';
import { ProfileForm } from './ProfileForm';
import styles from '../../studio.module.css';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const { user, isPublisher } = await currentPublisher();
  if (!user || !isPublisher) return null;   // the layout redirects or explains
  const supabase = await createClient();
  const { data } = await supabase.from('profiles').select('handle, display_name, tagline, bio, links').eq('id', user.id).maybeSingle();
  return (
    <main className={styles.stack}>
      <p><Link href="/studio">← Studio</Link></p>
      <div>
        <h1 className={styles.h1}>Your profile</h1>
        <p className={styles.muted}>Your name and tagline lead the home page; the bio and links are the about page.</p>
      </div>
      <ProfileForm initial={{
        displayName: data?.display_name ?? '',
        handle: data?.handle ?? '',
        tagline: data?.tagline ?? '',
        bio: data?.bio ?? '',
        links: linksToText(parseLinks(data?.links)),
      }} />
    </main>
  );
}
