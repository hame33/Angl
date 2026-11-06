import { SubscribeCta } from '@/components/SubscribeCta';

/* A placeholder until the real home page in Phase 3 (PLAN.md §6). */
export default function Home() {
  return (
    <main style={{ display: 'grid', gap: 24 }}>
      <section>
        <h1 style={{ fontSize: 28, lineHeight: 1.2 }}>Clips, drills and session plans</h1>
        <p style={{ color: 'var(--text2)', marginTop: 8 }}>
          Basketball film study from the newsletter. Shared clips live here; the full library is on its way.
        </p>
      </section>
      <SubscribeCta placement="home" />
    </main>
  );
}
