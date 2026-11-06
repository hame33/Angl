import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/metadata';
import { PostList } from '@/components/Cards';
import { SubscribeCta } from '@/components/SubscribeCta';
import { site } from '@/lib/site';
import { fetchPosts, type Post } from '@/lib/substack';

// Must be a literal: Next reads it statically. Keep equal to FEED_REVALIDATE_SECONDS.
export const revalidate = 3600;

export const metadata: Metadata = pageMetadata({ title: 'Writing', description: `Posts from ${site.name} on Substack.`, path: '/writing' });

/*
 * The posts come from the Substack feed, cached for an hour. A failed fetch is
 * allowed to throw: when a background refresh fails, Next keeps serving the
 * last good page, so a Substack outage never replaces real posts with an
 * error. Only when there has never been a good copy does error.tsx show,
 * uncached, with a link to Substack instead.
 */
export default async function Writing() {
  let posts: Post[] | null;
  try {
    posts = await fetchPosts();
  } catch (err) {
    // Rendering at build time: an outage must not fail the deploy. The
    // fallback is cached for at most the hour above, then retried.
    if (process.env.NEXT_PHASE !== 'phase-production-build') throw err;
    posts = null;
  }
  return (
    <main style={{ display: 'grid', gap: 24 }}>
      <section>
        <h1 style={{ fontSize: 28, lineHeight: 1.2 }}>Writing</h1>
        <p className="muted" style={{ marginTop: 6 }}>Everything is published on <a href={site.substackUrl}>Substack</a> first.</p>
      </section>
      {posts === null
        ? <p>The posts couldn’t be loaded just now. <a href={site.substackUrl}>Read them on Substack</a>.</p>
        : posts.length
          ? <PostList posts={posts} />
          : <p className="muted">No posts yet. <a href={site.substackUrl}>Visit the Substack</a>.</p>}
      <SubscribeCta placement="writing" />
    </main>
  );
}
