/* Small text helpers for share pages. Notes are plain text (PLAN.md D7). */

/* "Closeout to the nail!" → "closeout-to-the-nail". Only ever decorative: the
 * share id finds the clip, the slug just makes the link readable. */
export function slugify(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

/* A description for link previews: first ~155 characters on a word boundary. */
export function excerpt(text: string, max = 155): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?-]+$/, '') + '…';
}

export type TextSegment = { kind: 'text'; text: string } | { kind: 'link'; text: string; href: string };

/*
 * Split plain text into text and http(s) links, so notes can carry a URL
 * without the page ever rendering HTML from the database. Trailing
 * punctuation stays outside the link: "see https://x.com/a." links x.com/a.
 */
export function linkify(text: string): TextSegment[] {
  const out: TextSegment[] = [];
  const re = /https?:\/\/[^\s<>"]+/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let href = m[0];
    const trail = /[.,;:!?)\]]+$/.exec(href);
    if (trail) href = href.slice(0, -trail[0].length);
    if (m.index > last) out.push({ kind: 'text', text: text.slice(last, m.index) });
    out.push({ kind: 'link', text: href, href });
    last = m.index + href.length;
    re.lastIndex = last;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

/* Paragraphs are separated by a blank line; single line breaks stay inside one. */
export function paragraphs(text: string): string[] {
  return text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
}

/* 75 → "1:15", 3641 → "1:00:41". Same format classic Angl shows. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
