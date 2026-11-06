import { linkify, paragraphs } from '@/lib/text';

/* Plain text with URLs made clickable. Nothing from the database is ever
 * rendered as HTML. */
export function Linked({ text }: { text: string }) {
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

/* Blank lines are paragraph breaks; single line breaks are kept inside one. */
export function Prose({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className} style={{ display: 'grid', gap: 12, whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>
      {paragraphs(text).map((p, i) => <p key={i}><Linked text={p} /></p>)}
    </div>
  );
}
