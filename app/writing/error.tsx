'use client';

/* Only seen when the Substack feed fails and no good copy has ever been
 * cached. Not cached itself, so the next visit tries the feed again. */
export default function WritingError() {
  const substack = process.env.NEXT_PUBLIC_SUBSTACK_URL || 'https://hamishdawson33.substack.com';
  return (
    <main style={{ display: 'grid', gap: 16 }}>
      <h1 style={{ fontSize: 28, lineHeight: 1.2 }}>Writing</h1>
      <p>The posts couldn’t be loaded just now. <a href={substack}>Read them on Substack</a>.</p>
      <p><a href={`${substack}/subscribe`} data-umami-event="subscribe_click" data-umami-event-placement="writing-error">Subscribe on Substack</a></p>
    </main>
  );
}
