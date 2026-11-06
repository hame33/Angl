/*
 * The public library: clips marked public, newest first, filterable by tag.
 * Unlisted clips never appear here — the select asks for visibility=public,
 * and RLS would hide anything else from a signed-out read regardless.
 */
import { publicGet, TAGS } from './public-api.ts';
import { isShareId } from './shared-clip.ts';
import { isVideoId } from './youtube.ts';

export interface LibraryClip {
  shareId: string;
  title: string;
  tags: string[];
  notes: string;
  videoId: string;
  startSeconds: number;
  endSeconds: number;
  coachName: string | null;
  publishedAt: string | null;
}

export const PAGE_SIZE = 24;
const LIBRARY_REVALIDATE = 300;
const COLUMNS = 'share_id,title,tags,notes,youtube_video_id,start_seconds,end_seconds,credit_coach_name,published_at';

/* A tag as it appears in a URL (?tag=closeouts) → the stored form. */
export function normaliseTag(raw: string | string[] | undefined): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const t = (v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return t && t.length <= 40 ? t : null;
}

/* The PostgREST query for one page of the library. One extra row is asked
 * for, so the page knows whether there is a next one without a count query. */
export function libraryQuery(tag: string | null, page: number): string {
  const p = new URLSearchParams({ select: COLUMNS, visibility: 'eq.public', order: 'published_at.desc.nullslast,id.desc' });
  // cs = "array contains"; the value is a Postgres array literal, quoted so a
  // tag with a comma or brace in it can't break out of it
  if (tag) p.set('tags', `cs.{"${tag.replace(/["\\]/g, '\\$&')}"}`);
  p.set('limit', String(PAGE_SIZE + 1));
  p.set('offset', String(Math.max(0, page - 1) * PAGE_SIZE));
  return `clips?${p}`;
}

export function parseLibraryRows(rows: unknown): LibraryClip[] {
  if (!Array.isArray(rows)) return [];
  const out: LibraryClip[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    const start = Number(r.start_seconds), end = Number(r.end_seconds);
    if (!isShareId(r.share_id) || typeof r.title !== 'string' || !isVideoId(r.youtube_video_id)) continue;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    out.push({
      shareId: r.share_id,
      title: r.title,
      tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === 'string') : [],
      notes: typeof r.notes === 'string' ? r.notes : '',
      videoId: r.youtube_video_id,
      startSeconds: start,
      endSeconds: end,
      coachName: typeof r.credit_coach_name === 'string' ? r.credit_coach_name : null,
      publishedAt: typeof r.published_at === 'string' ? r.published_at : null,
    });
  }
  return out;
}

export async function listPublicClips(tag: string | null, page = 1): Promise<{ clips: LibraryClip[]; hasMore: boolean }> {
  const { data } = await publicGet<unknown[]>(libraryQuery(tag, page), { tags: [TAGS.library], revalidate: LIBRARY_REVALIDATE });
  const clips = parseLibraryRows(data);
  return { clips: clips.slice(0, PAGE_SIZE), hasMore: clips.length > PAGE_SIZE };
}

/* Every tag on a public clip, most used first, for the filter row. */
export async function listPublicTags(): Promise<{ tag: string; count: number }[]> {
  const { data } = await publicGet<{ tags: unknown }[]>('clips?select=tags&visibility=eq.public', { tags: [TAGS.library], revalidate: LIBRARY_REVALIDATE });
  return countTags(data.map(r => (Array.isArray(r.tags) ? r.tags : [])));
}

export function countTags(lists: unknown[][]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const list of lists) for (const t of list) if (typeof t === 'string') counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/* Every public clip's share id and title, for the sitemap. */
export async function listPublicClipLinks(): Promise<{ shareId: string; title: string; updatedAt: string | null }[]> {
  const { data } = await publicGet<Record<string, unknown>[]>('clips?select=share_id,title,updated_at&visibility=eq.public&order=published_at.desc', { tags: [TAGS.library], revalidate: LIBRARY_REVALIDATE });
  return data.filter(r => isShareId(r.share_id) && typeof r.title === 'string')
    .map(r => ({ shareId: r.share_id as string, title: r.title as string, updatedAt: typeof r.updated_at === 'string' ? r.updated_at : null }));
}
