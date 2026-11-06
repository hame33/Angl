import type { MetadataRoute } from 'next';
import { listPublicClipLinks } from '@/lib/library';
import { site } from '@/lib/site';
import { slugify } from '@/lib/text';

export const revalidate = 300;

/* Public pages only. Unlisted clips are left out by design — "anyone with
 * the link" is not "anyone with a search engine" — and so is the studio. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages: MetadataRoute.Sitemap = ['', '/library', '/writing', '/about'].map(p => ({ url: `${site.url}${p || '/'}` }));
  let clips: Awaited<ReturnType<typeof listPublicClipLinks>> = [];
  try { clips = await listPublicClipLinks(); } catch { /* the static pages are still worth listing */ }
  return pages.concat(clips.map(c => {
    const slug = slugify(c.title);
    return { url: `${site.url}/clips/${c.shareId}${slug ? `/${slug}` : ''}`, lastModified: c.updatedAt ?? undefined };
  }));
}
