/*
 * The Substack feed, read server-side for the writing page and the home page.
 *
 * Hand-written rather than a general XML parser: the one feed it reads has a
 * known shape (Substack's RSS 2.0), only six fields are wanted, and the
 * parser that would have done it pulls in six packages of its own. What makes
 * this safe is the fixture in substack.test.ts, modelled on the real feed —
 * CDATA fields, entities left encoded inside CDATA, image enclosures, and post
 * bodies full of HTML that must not be mistaken for the item's own fields.
 */
import { site } from './site.ts';

export interface Post {
  title: string;
  subtitle: string;
  url: string;
  publishedAt: string | null;   // ISO
  image: string | null;         // https only
}

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
};

/* Substack writes "&#8212;" inside CDATA, where no XML parser would decode it. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED[ref.toLowerCase()] ?? whole;
  });
}

function field(item: string, tag: string): string | null {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`).exec(item);
  if (!m) return null;
  const inner = m[1]!.trim();
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(inner);
  // CDATA is literal text (but Substack still puts entities in it); outside
  // CDATA, any markup left is someone else's HTML and is dropped.
  const text = cdata ? cdata[1]! : inner.replace(/<[^>]*>/g, '');
  return decodeEntities(text).replace(/\s+/g, ' ').trim();
}

const https = (u: string | null | undefined): string | null => (u && /^https:\/\/[^\s"<>]+$/.test(u) ? u : null);

export function parseFeed(xml: string): Post[] {
  const posts: Post[] = [];
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)) {
    // The post body is HTML (SVG titles, links…) and comes after the fields we
    // want, but remove it first so no field can ever be read from inside it.
    const item = m[1]!.replace(/<content:encoded\b[^>]*>[\s\S]*?<\/content:encoded>/g, '');
    const title = field(item, 'title');
    const url = https(field(item, 'link'));
    if (!title || !url) continue;
    const date = field(item, 'pubDate');
    const parsed = date ? new Date(date) : null;
    const enclosure = /<enclosure\b[^>]*>/.exec(item)?.[0] ?? '';
    const type = /\btype="([^"]*)"/.exec(enclosure)?.[1] ?? '';
    posts.push({
      title,
      subtitle: field(item, 'description') ?? '',
      url,
      publishedAt: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null,
      image: type.startsWith('image/') ? https(decodeEntities(/\burl="([^"]*)"/.exec(enclosure)?.[1] ?? '')) : null,
    });
  }
  return posts.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
}

export const FEED_REVALIDATE_SECONDS = 3600;

/*
 * Throws when the feed can't be read. A page that calls this inside its
 * render keeps serving its last good version while Substack is down (Next
 * doesn't replace a cached page with one that failed to render); callers
 * catch only on the very first render, when there is nothing older to show.
 */
export async function fetchPosts(): Promise<Post[]> {
  const res = await fetch(`${site.substackUrl}/feed`, {
    headers: { Accept: 'application/rss+xml, application/xml' },
    next: { revalidate: FEED_REVALIDATE_SECONDS, tags: ['substack'] },
  });
  if (!res.ok) throw new Error(`Substack feed: HTTP ${res.status}`);
  const xml = await res.text();
  if (!/<channel\b/.test(xml)) throw new Error('Substack feed: not RSS');
  return parseFeed(xml);
}
