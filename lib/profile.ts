/*
 * The site owner's profile: the home page's one-liner and the about page.
 * Stored in Supabase rather than in the repo, so the MIT codebase carries no
 * personal content (PLAN.md §8). Which profile is "the site" is
 * SITE_OWNER_HANDLE, or the oldest profile when that isn't set — in the
 * single-publisher phase there is only one.
 */
import { publicGet, TAGS } from './public-api.ts';

export interface ProfileLink { label: string; url: string }
export interface Profile {
  handle: string;
  displayName: string;
  tagline: string;
  bio: string;
  links: ProfileLink[];
}

export function parseLinks(raw: unknown): ProfileLink[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(l => {
    const r = l as Record<string, unknown>;
    return typeof r?.label === 'string' && typeof r.url === 'string' && /^https:\/\//.test(r.url)
      ? [{ label: r.label, url: r.url }] : [];
  });
}

/* "Instagram | https://instagram.com/x" per line, the studio's editing form. */
export function linksFromText(text: string): ProfileLink[] {
  return text.split('\n').flatMap(line => {
    const [label, url] = line.split('|').map(s => s.trim());
    return label && url && /^https:\/\/[^\s]+$/.test(url) ? [{ label: label.slice(0, 60), url: url.slice(0, 500) }] : [];
  }).slice(0, 12);
}
export const linksToText = (links: ProfileLink[]) => links.map(l => `${l.label} | ${l.url}`).join('\n');

export async function getSiteProfile(): Promise<Profile | null> {
  const handle = process.env.SITE_OWNER_HANDLE;
  const filter = handle ? `&handle=eq.${encodeURIComponent(handle)}` : '';
  const { data } = await publicGet<Record<string, unknown>[]>(
    `profiles?select=handle,display_name,tagline,bio,links${filter}&order=created_at.asc&limit=1`,
    { tags: [TAGS.profile], revalidate: 3600 },
  );
  const r = data[0];
  if (!r || typeof r.handle !== 'string' || typeof r.display_name !== 'string') return null;
  return {
    handle: r.handle,
    displayName: r.display_name,
    tagline: typeof r.tagline === 'string' ? r.tagline : '',
    bio: typeof r.bio === 'string' ? r.bio : '',
    links: parseLinks(r.links),
  };
}
