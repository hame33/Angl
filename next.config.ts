import type { NextConfig } from 'next';

const config: NextConfig = {
  poweredByHeader: false,
  images: {
    // The share page's poster is YouTube's own thumbnail, resized to the
    // visitor's screen and re-encoded (AVIF/WebP) by Next's image optimiser.
    remotePatterns: [{ protocol: 'https', hostname: 'i.ytimg.com', pathname: '/vi/**' }],
    formats: ['image/avif', 'image/webp'],
    // Thumbnails never change for a given URL, so cache the resized copies for a month
    minimumCacheTTL: 2678400,
  },
  experimental: {
    // Inline the (small) stylesheet so first paint doesn't wait on a CSS request
    inlineCss: true,
  },
  // Classic Angl (index.html, serve.sh, clip_downloader.py) lives at the repo
  // root alongside this app. Next only serves app/ and public/, so it never
  // touches those files.
};

export default config;
