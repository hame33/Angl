import type { Metadata } from 'next';

// The studio is yours alone: keep it out of search engines and link previews
export const metadata: Metadata = {
  title: 'Studio',
  robots: { index: false, follow: false },
};

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return children;
}
