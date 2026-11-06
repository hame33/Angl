import type { Metadata } from 'next';
import { Prose } from '@/components/Prose';
import { pageMetadata } from '@/lib/metadata';
import { SubscribeCta } from '@/components/SubscribeCta';
import { excerpt } from '@/lib/text';
import { getSiteProfile } from '@/lib/profile';
import { site } from '@/lib/site';

export const revalidate = 3600;   // the studio's profile editor refreshes it straight away

export async function generateMetadata(): Promise<Metadata> {
  const profile = await getSiteProfile().catch(() => null);
  const description = profile?.tagline || (profile?.bio ? excerpt(profile.bio) : `About ${site.name}.`);
  return pageMetadata({ title: 'About', description, path: '/about' });
}

export default async function About() {
  const profile = await getSiteProfile().catch(() => null);
  return (
    <main style={{ display: 'grid', gap: 24 }}>
      <section style={{ display: 'grid', gap: 10 }}>
        <h1 style={{ fontSize: 28, lineHeight: 1.2 }}>{profile?.displayName || `About ${site.name}`}</h1>
        {profile?.tagline && <p className="muted" style={{ fontSize: 17 }}>{profile.tagline}</p>}
      </section>
      {profile?.bio
        ? <Prose text={profile.bio} />
        : <p className="muted">More about this site soon. In the meantime, the writing is on <a href={site.substackUrl}>Substack</a>.</p>}
      {profile && profile.links.length > 0 && (
        <ul style={{ listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: '8px 18px' }}>
          {profile.links.map(l => <li key={l.url}><a href={l.url} rel="me noopener">{l.label}</a></li>)}
        </ul>
      )}
      <SubscribeCta placement="about" />
    </main>
  );
}
