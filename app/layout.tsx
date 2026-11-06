import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { Analytics } from '@/components/Analytics';
import { site } from '@/lib/site';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: site.name, template: `%s · ${site.name}` },
  description: 'Basketball clips, drills and session plans.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0d0d0f',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="page">
          <header className="site-header">
            <Link href="/" className="site-name">{site.name}</Link>
            <a className="subscribe-link" href={site.subscribeUrl}
               data-umami-event="subscribe_click" data-umami-event-placement="header">
              Subscribe
            </a>
          </header>
          {children}
          <footer className="site-footer">
            <p>
              Video is embedded from YouTube and belongs to its creators. Built
              with <a href="https://github.com/hame33/Angl">Angl</a>, an open-source film room for coaches.
            </p>
          </footer>
        </div>
        <Analytics />
      </body>
    </html>
  );
}
