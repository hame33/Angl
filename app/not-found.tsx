import Link from 'next/link';
import { SubscribeCta } from '@/components/SubscribeCta';

/* Private, unpublished and unknown clips all land here, and say the same thing,
   so a link can't be used to learn whether a private clip exists. */
export default function NotFound() {
  return (
    <main style={{ display: 'grid', gap: 24 }}>
      <section>
        <h1 style={{ fontSize: 26, lineHeight: 1.2 }}>This clip isn’t available</h1>
        <p style={{ color: 'var(--text2)', marginTop: 8 }}>
          It may have been unpublished, or the link is incomplete. <Link href="/">Go to the home page</Link>.
        </p>
      </section>
      <SubscribeCta placement="not-found" />
    </main>
  );
}
