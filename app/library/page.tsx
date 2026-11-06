import type { Metadata } from 'next';
import Link from 'next/link';
import { ClipGrid } from '@/components/Cards';
import { SubscribeCta } from '@/components/SubscribeCta';
import { listPublicClips, listPublicTags, normaliseTag } from '@/lib/library';
import { pageMetadata } from '@/lib/metadata';

type Search = Promise<{ tag?: string | string[]; page?: string | string[] }>;

function pageNumber(raw: string | string[] | undefined): number {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(n) && n > 1 && n < 10000 ? n : 1;
}

function href(tag: string | null, page = 1): string {
  const p = new URLSearchParams();
  if (tag) p.set('tag', tag);
  if (page > 1) p.set('page', String(page));
  const q = p.toString();
  return `/library${q ? `?${q}` : ''}`;
}

export async function generateMetadata({ searchParams }: { searchParams: Search }): Promise<Metadata> {
  const sp = await searchParams;
  const tag = normaliseTag(sp.tag);
  const page = pageNumber(sp.page);
  const title = tag ? `Clips tagged “${tag}”` : 'Clip library';
  const description = tag ? `Basketball clips tagged ${tag}, with coaching notes.` : 'Basketball clips with coaching notes, from YouTube film.';
  return pageMetadata({ title, description, path: href(tag, page) });
}

export default async function Library({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const tag = normaliseTag(sp.tag);
  const page = pageNumber(sp.page);
  const [{ clips, hasMore }, tags] = await Promise.all([listPublicClips(tag, page), listPublicTags()]);

  return (
    <main style={{ display: 'grid', gap: 22 }}>
      <section>
        <h1 style={{ fontSize: 28, lineHeight: 1.2 }}>{tag ? <>Clips tagged “{tag}”</> : 'Clip library'}</h1>
        {tag && <p style={{ marginTop: 6 }}><Link href="/library">All clips</Link></p>}
      </section>

      {tags.length > 0 && (
        <nav aria-label="Filter by tag" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {tags.slice(0, 30).map(t => (
            <Link key={t.tag} href={href(t.tag === tag ? null : t.tag)} aria-current={t.tag === tag ? 'true' : undefined}
                  style={{
                    padding: '6px 12px', minHeight: 36, display: 'inline-flex', alignItems: 'center', borderRadius: 999,
                    border: `1px solid ${t.tag === tag ? 'var(--accent)' : 'var(--border2)'}`,
                    background: t.tag === tag ? 'var(--accent-bg)' : 'var(--bg3)',
                    color: t.tag === tag ? 'var(--accent)' : 'var(--text2)', fontSize: 14, textDecoration: 'none',
                  }}>
              {t.tag} · {t.count}
            </Link>
          ))}
        </nav>
      )}

      {clips.length
        ? <ClipGrid clips={clips} />
        : <p className="muted">{tag ? `No public clips are tagged “${tag}” yet.` : 'No public clips yet.'}</p>}

      {(page > 1 || hasMore) && (
        <nav aria-label="Pages" style={{ display: 'flex', justifyContent: 'space-between' }}>
          {page > 1 ? <Link href={href(tag, page - 1)}>← Newer</Link> : <span />}
          {hasMore ? <Link href={href(tag, page + 1)}>Older →</Link> : <span />}
        </nav>
      )}

      <SubscribeCta placement="library" />
    </main>
  );
}
