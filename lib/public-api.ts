/*
 * Signed-out reads from Supabase for the public site: plain cached GETs to
 * PostgREST with the publishable key. No cookies, no client library, so the
 * pages built on them can be cached and served to everyone. Row-level
 * security decides what a signed-out visitor can see (public rows only).
 */
import { site } from './site.ts';

export class PublicApiError extends Error {}

export async function publicGet<T>(path: string, opts: { tags: string[]; revalidate: number; headers?: Record<string, string> }): Promise<{ data: T; headers: Headers }> {
  const { url, publishableKey } = site.supabase;
  if (!url || !publishableKey) throw new PublicApiError('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set');
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: publishableKey, Accept: 'application/json', ...opts.headers },
    next: { revalidate: opts.revalidate, tags: opts.tags },
  });
  if (!res.ok) throw new PublicApiError(`${path.split('?')[0]}: HTTP ${res.status}`);
  return { data: (await res.json()) as T, headers: res.headers };
}

/* Cache tags shared by the public pages and the studio actions that change them. */
export const TAGS = {
  library: 'library',     // any public clip list: /library, the home page, the sitemap
  profile: 'profile',     // the site owner's profile: home, about
} as const;
