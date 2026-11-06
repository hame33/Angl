#!/usr/bin/env node
/*
 * Crawls every page the sitemap lists and checks what each public page must
 * have (PLAN.md Phase 3): a 200, complete link-preview tags, a canonical URL,
 * the Substack subscribe link, and — with --analytics — the Umami tag.
 * Also checks robots.txt keeps crawlers out of the studio.
 *
 *   npm run check:site -- https://angl-six.vercel.app [--analytics]
 *
 * Read-only: it only ever sends GETs.
 */
const args = process.argv.slice(2);
const base = (args.find(a => !a.startsWith('--')) || 'http://localhost:3000').replace(/\/+$/, '');
const wantAnalytics = args.includes('--analytics');

let failed = 0;
const check = (ok, name, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); if (!ok) failed++; };
const meta = (html, attr, key) => {
  const m = new RegExp(`<meta[^>]*${attr}="${key}"[^>]*content="([^"]*)"`).exec(html) || new RegExp(`<meta[^>]*content="([^"]*)"[^>]*${attr}="${key}"`).exec(html);
  return m ? m[1] : null;
};

const robots = await (await fetch(`${base}/robots.txt`)).text();
check(/Disallow: \/studio/.test(robots) && /Disallow: \/auth/.test(robots), 'robots.txt disallows /studio and /auth');
check(/Sitemap: \S+\/sitemap\.xml/.test(robots), 'robots.txt names the sitemap');

const sitemap = await (await fetch(`${base}/sitemap.xml`)).text();
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
check(urls.length >= 4, 'sitemap lists the site pages', `${urls.length} URLs`);
check(!urls.some(u => /\/studio|\/auth/.test(u)), 'sitemap lists nothing private');

for (const listed of urls) {
  // The sitemap carries the production address; crawl the one being checked
  const url = listed.replace(/^https?:\/\/[^/]+/, base);
  const path = url.slice(base.length) || '/';
  const res = await fetch(url, { redirect: 'manual' });
  const html = await res.text();
  const missing = [];
  if (res.status !== 200) missing.push(`HTTP ${res.status}`);
  for (const k of ['og:title', 'og:description', 'og:url', 'og:image']) if (!meta(html, 'property', k)) missing.push(k);
  if (!meta(html, 'name', 'twitter:card')) missing.push('twitter:card');
  const image = meta(html, 'property', 'og:image');
  if (image && !/^https?:\/\//.test(image)) missing.push('og:image is not absolute');
  if (!/<link rel="canonical"/.test(html)) missing.push('canonical');
  if (!/href="https:\/\/[^"]+\/subscribe"/.test(html)) missing.push('subscribe link');
  if (/name="robots" content="noindex/.test(html)) missing.push('noindex on a sitemap page');
  if (wantAnalytics && !/data-website-id=/.test(html)) missing.push('analytics');
  check(!missing.length, path, missing.join(', '));
}

console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
