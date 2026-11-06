/*
 * Everything that makes this deployment *your* site comes from the
 * environment, so the MIT codebase carries no personal content (PLAN.md §8).
 */

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return trimSlash(explicit);
  // Vercel sets this on every deployment, without a scheme
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return `https://${trimSlash(vercel)}`;
  return 'http://localhost:3000';
}

const substack = trimSlash(process.env.NEXT_PUBLIC_SUBSTACK_URL || 'https://hamishdawson33.substack.com');

export const site = {
  name: process.env.NEXT_PUBLIC_SITE_NAME || 'Angl',
  url: siteUrl(),
  substackUrl: substack,
  subscribeUrl: `${substack}/subscribe`,
  umami: {
    websiteId: process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID || '',
    scriptUrl: process.env.NEXT_PUBLIC_UMAMI_SCRIPT_URL || 'https://cloud.umami.is/script.js',
  },
  supabase: {
    url: trimSlash(process.env.NEXT_PUBLIC_SUPABASE_URL || ''),
    publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '',
  },
} as const;
