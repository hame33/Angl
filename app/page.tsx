import type { Metadata } from 'next';
import Link from 'next/link';
import { pageMetadata } from '@/lib/metadata';
import { ClipGrid, PostList } from '@/components/Cards';
import { SubscribeCta } from '@/components/SubscribeCta';
import { listPublicClips, type LibraryClip } from '@/lib/library';
import { getSiteProfile } from '@/lib/profile';
import { site } from '@/lib/site';
import { fetchPosts, type Post } from '@/lib/substack';

// The newest clips change most often, so the page is re-checked every 5 minutes
export const revalidate = 300;

const FALLBACK_TAGLINE = 'Basketball film study, drills and session plans.';

export async function generateMetadata(): Promise<Metadata> {
  const profile = await getSiteProfile().catch(() => null);
  const description = profile?.tagline || FALLBACK_TAGLINE;
  return { ...pageMetadata({ title: site.name, description, path: '/' }), title: { absolute: site.name } };
}

/* A broken feed or an empty library mustn't take the home page down with it */
async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try { return await p; } catch { return fallback; }
}

export default async function Home() {
  const [profile, posts, library] = await Promise.all([
    safe(getSiteProfile(), null),
    safe<Post[] | null>(fetchPosts(), null),
    safe<{ clips: LibraryClip[] }>(listPublicClips(null), { clips: [] }),
  ]);
  const clips = library.clips.slice(0, 6);

  return (
    <main style={{ display: 'grid', gap: 32 }}>
      <section>
        <h1 style={{ fontSize: 30, lineHeight: 1.15, letterSpacing: '-0.02em' }}>{profile?.displayName || site.name}</h1>
        <p className="muted" style={{ marginTop: 8, fontSize: 17 }}>{profile?.tagline || FALLBACK_TAGLINE}</p>
      </section>

      <SubscribeCta placement="home-top" />

      <section>
        <div className="section-head"><h2>Latest writing</h2><Link href="/writing">All posts</Link></div>
        {posts && posts.length
          ? <PostList posts={posts.slice(0, 3)} />
          : <p className="muted">Read the latest on <a href={site.substackUrl}>Substack</a>.</p>}
      </section>

      {clips.length > 0 && (
        <section>
          <div className="section-head"><h2>Latest clips</h2><Link href="/library">Library</Link></div>
          <ClipGrid clips={clips} />
        </section>
      )}
    </main>
  );
}
