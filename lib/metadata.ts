/*
 * Link-preview metadata for the site's own pages. A page's `openGraph` object
 * replaces the layout's wholesale in Next, image included, so every page sets
 * the default card explicitly. Clip pages build their own, with the clip's
 * YouTube thumbnail.
 */
import type { Metadata } from 'next';
import { site } from './site.ts';

export const DEFAULT_OG_IMAGE = { url: '/og', width: 1200, height: 630 };

export function pageMetadata({ title, description, path }: { title: string; description: string; path: string }): Metadata {
  const full = title === site.name ? title : `${title} · ${site.name}`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: 'website', siteName: site.name, title: full, description, url: path, images: [{ ...DEFAULT_OG_IMAGE, alt: site.name }] },
    twitter: { card: 'summary_large_image', title: full, description, images: [DEFAULT_OG_IMAGE.url] },
  };
}
