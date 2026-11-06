/*
 * The share page's single read: get_shared_clip(share_id), an RPC that
 * returns public and unlisted clips only (supabase/migrations, PLAN.md §4).
 *
 * It is a plain GET to PostgREST rather than supabase-js: one cacheable
 * request, no client library on the read path, and Next's fetch cache can tag
 * it so a publish (Phase 2) revalidates exactly this clip.
 */
import { isVideoId } from './youtube.ts';
import { site } from './site.ts';

export interface SharedClip {
  shareId: string;
  visibility: 'public' | 'unlisted';
  title: string;
  tags: string[];
  notes: string;
  coachingPoints: string[];
  videoId: string;
  startSeconds: number;
  endSeconds: number;
  credit: {
    coachName: string | null;    // the coach in the clip
    url: string | null;          // the coach's own channel or site
    sourceTitle: string | null;  // the source video's title
    channelName: string | null;  // who uploaded it, when that isn't the coach
    channelUrl: string | null;
  };
  thumbnailUrl: string | null;
  publishedAt: string | null;
  updatedAt: string;
}

const SHARE_ID = /^[A-Za-z0-9_-]{11}$/;
export function isShareId(id: unknown): id is string {
  return typeof id === 'string' && SHARE_ID.test(id);
}

export function clipCacheTag(shareId: string): string {
  return `clip:${shareId}`;
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
// numeric columns arrive as JSON numbers from jsonb_build_object
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const httpsUrl = (v: unknown): string | null => {
  const s = str(v);
  return s && /^https:\/\//.test(s) ? s : null;
};

/*
 * The RPC's payload, checked rather than trusted. Anything that could not be
 * played or rendered safely reads as "no clip" and the page 404s — a broken
 * row should never become a broken public page.
 */
export function parseSharedClip(raw: unknown): SharedClip | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const video = (r.video && typeof r.video === 'object' ? r.video : {}) as Record<string, unknown>;
  const credit = (r.credit && typeof r.credit === 'object' ? r.credit : {}) as Record<string, unknown>;

  const shareId = str(r.shareId);
  const title = str(r.title);
  const videoId = video.videoId;
  const start = num(r.startSeconds);
  const end = num(r.endSeconds);
  const visibility = r.visibility;

  if (!isShareId(shareId) || !title || !isVideoId(videoId)) return null;
  if (start === null || end === null || start < 0 || end <= start) return null;
  if (visibility !== 'public' && visibility !== 'unlisted') return null;

  return {
    shareId,
    visibility,
    title,
    tags: strings(r.tags),
    notes: str(r.notes) ?? '',
    coachingPoints: strings(r.coachingPoints),
    videoId,
    startSeconds: start,
    endSeconds: end,
    credit: {
      coachName: str(credit.coachName),
      url: httpsUrl(credit.url),
      sourceTitle: str(credit.sourceTitle),
      channelName: str(credit.channelName),
      channelUrl: httpsUrl(credit.channelUrl),
    },
    thumbnailUrl: httpsUrl(r.thumbnailUrl),
    publishedAt: str(r.publishedAt),
    updatedAt: str(r.updatedAt) ?? '',
  };
}

/* How long a cached page may go before it is re-checked, even with no publish. */
export const CLIP_REVALIDATE_SECONDS = 300;

/*
 * null means "no such shareable clip" and becomes a 404. A failure to reach
 * Supabase throws instead, so an outage serves the last good page from cache
 * rather than caching a 404 for a clip that exists.
 */
export async function fetchSharedClip(shareId: string): Promise<SharedClip | null> {
  if (!isShareId(shareId)) return null;
  const { url, publishableKey } = site.supabase;
  if (!url || !publishableKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set');
  }
  const res = await fetch(`${url}/rest/v1/rpc/get_shared_clip?p_share_id=${encodeURIComponent(shareId)}`, {
    headers: { apikey: publishableKey, Accept: 'application/json' },
    next: { revalidate: CLIP_REVALIDATE_SECONDS, tags: [clipCacheTag(shareId)] },
  });
  if (!res.ok) throw new Error(`get_shared_clip failed: HTTP ${res.status}`);
  return parseSharedClip(await res.json());
}
