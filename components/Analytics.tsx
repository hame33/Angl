import Script from 'next/script';
import { site } from '@/lib/site';

/*
 * Umami: cookieless, one small script, and it counts page views on its own.
 * Clicks are counted by `data-umami-event` attributes on the links themselves,
 * so the components need no analytics code. With no website id set (local
 * development, forks) nothing loads at all.
 */
export function Analytics() {
  const { websiteId, scriptUrl } = site.umami;
  if (!websiteId) return null;
  return <Script src={scriptUrl} data-website-id={websiteId} strategy="afterInteractive" />;
}
