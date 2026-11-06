import { ImageResponse } from 'next/og';
import { site } from '@/lib/site';

/*
 * The site's default link-preview card (1200×630), drawn by Next's built-in
 * image renderer: no image file in the repo, and the name comes from the
 * environment, so a fork gets its own card. Static: built once at deploy.
 */
export const dynamic = 'force-static';

export function GET() {
  return new ImageResponse(
    (
      <div style={{
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        padding: 80, background: '#0d0d0f', color: '#f0f0f2',
      }}>
        <div style={{ display: 'flex', width: 96, height: 96, borderRadius: 22, background: '#e8782a' }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ fontSize: 88, fontWeight: 700, letterSpacing: -2 }}>{site.name}</div>
          <div style={{ fontSize: 38, color: '#a3a3b2' }}>Basketball clips, drills and session plans</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
