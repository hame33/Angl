import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { cache } from 'react';
import { ClipPlayer } from '@/components/ClipPlayer';
import { SubscribeCta } from '@/components/SubscribeCta';
import { fetchSharedClip, type SharedClip } from '@/lib/shared-clip';
import { site } from '@/lib/site';
import { clock, excerpt, linkify, paragraphs, slugify } from '@/lib/text';
import { thumbnailFor, watchUrl } from '@/lib/youtube';
import styles from './page.module.css';

/*
 * /clips/{shareId}/{optional-title-slug}
 *
 * Rendered on first request, then served from the cache (ISR) and re-checked
 * every few minutes. Publishing or editing a clip (Phase 2) revalidates its
 * cache tag, so a change shows up without waiting for that.
 */
// Must be a literal: Next reads it statically. Keep equal to CLIP_REVALIDATE_SECONDS.
export const revalidate = 300;
export const dynamicParams = true;
export function generateStaticParams() {
  return [];   // none at build time; every clip is cached the first time it is opened
}

type Params = Promise<{ shareId: string; slug?: string[] }>;

const getClip = cache((shareId: string) => fetchSharedClip(shareId));

function canonicalPath(clip: SharedClip): string {
  const slug = slugify(clip.title);
  return `/clips/${clip.shareId}${slug ? `/${slug}` : ''}`;
}

function describe(clip: SharedClip): string {
  if (clip.notes.trim()) return excerpt(clip.notes);
  if (clip.coachingPoints.length) return excerpt(clip.coachingPoints.join(' · '));
  return clip.credit.coachName ? `A basketball clip from ${clip.credit.coachName}.` : 'A basketball clip.';
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { shareId } = await params;
  const clip = await getClip(shareId);
  if (!clip) return { title: 'Clip not available', robots: { index: false, follow: false } };

  const description = describe(clip);
  const thumb = thumbnailFor(clip.videoId, clip.thumbnailUrl);
  const url = canonicalPath(clip);
  return {
    title: clip.title,
    description,
    alternates: { canonical: url },
    // Unlisted means "anyone with the link", not "anyone with a search engine"
    robots: clip.visibility === 'unlisted' ? { index: false, follow: false } : undefined,
    openGraph: {
      type: 'video.other',
      url,
      siteName: site.name,
      title: clip.title,
      description,
      images: [{ url: thumb.url, width: thumb.width, height: thumb.height, alt: clip.title }],
    },
    twitter: {
      card: 'summary_large_image',
      title: clip.title,
      description,
      images: [thumb.url],
    },
  };
}

function Linked({ text }: { text: string }) {
  return (
    <>
      {linkify(text).map((seg, i) =>
        seg.kind === 'link'
          ? <a key={i} href={seg.href} rel="nofollow noopener noreferrer">{seg.text}</a>
          : <span key={i}>{seg.text}</span>,
      )}
    </>
  );
}

export default async function ClipPage({ params }: { params: Params }) {
  const { shareId, slug } = await params;
  const clip = await getClip(shareId);
  if (!clip) notFound();

  // A renamed clip keeps working under its old slug, and lands on the new one
  const canonical = canonicalPath(clip);
  const asked = `/clips/${shareId}${slug && slug.length ? `/${slug.join('/')}` : ''}`;
  if (asked !== canonical) permanentRedirect(canonical);

  const thumb = thumbnailFor(clip.videoId, clip.thumbnailUrl);
  const length = Math.round(clip.endSeconds - clip.startSeconds);
  const source = watchUrl(clip.videoId, clip.startSeconds);
  const { coachName, url: coachUrl, sourceTitle, channelName, channelUrl } = clip.credit;

  return (
    <main className={styles.main}>
      <ClipPlayer
        shareId={clip.shareId}
        videoId={clip.videoId}
        startSeconds={clip.startSeconds}
        endSeconds={clip.endSeconds}
        title={clip.title}
        thumbnail={thumb}
      />

      <header className={styles.head}>
        <h1>{clip.title}</h1>
        <p className={styles.meta}>
          {length}s clip · {clock(clip.startSeconds)}–{clock(clip.endSeconds)} in the source video
        </p>
        {/* The coach and the uploader are credited separately: they are often
            different people (a Calipari practice posted by HawgBeat.com). */}
        {coachName && (
          <p className={styles.credit}>
            Coach:{' '}
            {coachUrl
              ? <a href={coachUrl} rel="noopener" data-umami-event="credit_click">{coachName}</a>
              : <span>{coachName}</span>}
          </p>
        )}
        <p className={styles.credit}>
          Footage:{' '}
          <a href={source} rel="noopener" data-umami-event="source_click">{sourceTitle || 'the source video'}</a>
          {channelName && channelName !== coachName && (
            <>
              {' '}by{' '}
              {channelUrl
                ? <a href={channelUrl} rel="noopener" data-umami-event="channel_click">{channelName}</a>
                : <span>{channelName}</span>}
            </>
          )}
          {' '}on YouTube
        </p>
        {clip.tags.length > 0 && (
          <ul className={styles.tags} aria-label="Tags">
            {clip.tags.map(t => <li key={t}><Link href={`/library?tag=${encodeURIComponent(t)}`}>{t}</Link></li>)}
          </ul>
        )}
      </header>

      {clip.notes.trim() && (
        <section className={styles.notes} aria-label="Notes">
          {paragraphs(clip.notes).map((p, i) => <p key={i}><Linked text={p} /></p>)}
        </section>
      )}

      {clip.coachingPoints.length > 0 && (
        <section className={styles.points}>
          <h2>Coaching points</h2>
          <ul>{clip.coachingPoints.map((p, i) => <li key={i}><Linked text={p} /></li>)}</ul>
        </section>
      )}

      <p>
        <a className={styles.source} href={source} rel="noopener" data-umami-event="source_click">
          Watch the full video on YouTube
        </a>
      </p>

      <SubscribeCta placement="clip" />
    </main>
  );
}
