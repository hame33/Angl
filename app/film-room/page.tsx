import type { Metadata } from 'next';
import { FilmRoom } from './FilmRoom';

// A coach's own working space, kept in their browser: not for search engines
export const metadata: Metadata = {
  title: 'Film room',
  robots: { index: false, follow: false },
};

export default function FilmRoomPage() {
  return <FilmRoom />;
}
