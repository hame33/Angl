'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { isIOS } from '@/lib/device';
import { embedUrl } from '@/lib/youtube';
import styles from './ClipPlayer.module.css';

declare global {
  interface Window { umami?: { track: (event: string, data?: Record<string, string>) => void } }
}

interface Props {
  shareId: string;
  videoId: string;
  startSeconds: number;
  endSeconds: number;
  title: string;
  thumbnail: { url: string; width: number; height: number };
}

/* `run` keys the iframe: bumping it remounts the player at the clip's start. */
interface Embed { run: number; autoplay: boolean }

function track(event: string, shareId: string) {
  try { window.umami?.track(event, { shareId }); } catch { /* analytics never breaks playback */ }
}

/*
 * A facade: the page ships a thumbnail and a button, and YouTube's player
 * (several hundred KB of script) only loads when someone taps play. That is
 * what keeps a share page fast on a phone arriving from Substack.
 *
 * iOS is the exception. It only starts a video with sound when the tap lands
 * inside the player's own frame, so tapping our facade there loads a player
 * that then waits for a second tap. On iOS the real player is loaded instead,
 * without autoplay, once the page has finished loading: the thumbnail still
 * paints first, and the visitor's one tap lands on YouTube's own play button.
 *
 * The embed's start/end parameters stop the clip, so there is no polling.
 * Replay remounts the iframe, which restarts at `start`.
 */
export function ClipPlayer({ shareId, videoId, startSeconds, endSeconds, title, thumbnail }: Props) {
  const [embed, setEmbed] = useState<Embed | null>(null);
  const [shown, setShown] = useState(false);     // the iframe has loaded and covers the poster
  const [played, setPlayed] = useState(false);
  const ios = useRef(false);
  const frame = useRef<HTMLIFrameElement>(null);

  // iOS: swap in the real player after load, so it never competes with the thumbnail
  useEffect(() => {
    ios.current = isIOS(navigator.userAgent, navigator.maxTouchPoints);
    if (!ios.current) return;
    const swap = () => setEmbed(e => e ?? { run: 1, autoplay: false });
    if (document.readyState === 'complete') { const t = setTimeout(swap, 0); return () => clearTimeout(t); }
    window.addEventListener('load', swap, { once: true });
    return () => window.removeEventListener('load', swap);
  }, []);

  // A tap inside a cross-origin player can't be seen directly, but it moves
  // focus into the iframe, which blurs this window. That is the iOS play.
  useEffect(() => {
    if (!embed || embed.autoplay || played) return;
    const onBlur = () => {
      setTimeout(() => {
        if (document.activeElement === frame.current) { setPlayed(true); track('clip_play', shareId); }
      }, 0);
    };
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, [embed, played, shareId]);

  function play() {
    track(played ? 'clip_replay' : 'clip_play', shareId);
    setPlayed(true);
    setShown(false);
    // On iOS a replay remounts at the start and waits for YouTube's own button
    setEmbed(e => ({ run: (e?.run ?? 0) + 1, autoplay: !ios.current }));
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.frame}>
        {/* Stays underneath until the player has loaded, so a swap never
            flashes black. */}
        {!shown && (
          <button type="button" className={styles.facade} onClick={play} aria-label={`Play clip: ${title}`}
                  tabIndex={embed ? -1 : 0}>
            {/* The page's largest element: preloaded at high priority, and
                resized to the screen by next/image so a phone isn't sent the
                1280px original. (`priority` is deprecated in Next 16 and no
                longer sets fetchpriority, so both are spelled out.) */}
            <Image
              src={thumbnail.url}
              width={thumbnail.width}
              height={thumbnail.height}
              alt=""
              preload
              fetchPriority="high"
              loading="eager"
              sizes="(max-width: 760px) 100vw, 728px"
            />
            <span className={styles.play} aria-hidden="true">
              <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
            </span>
          </button>
        )}
        {embed && (
          <iframe
            key={embed.run}
            ref={frame}
            className={shown ? undefined : styles.loading}
            src={embedUrl(videoId, startSeconds, endSeconds, embed.autoplay)}
            title={title}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            onLoad={() => setShown(true)}
          />
        )}
      </div>
      {played && (
        <button type="button" className={styles.replay} onClick={play}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" />
          </svg>
          Replay clip
        </button>
      )}
    </div>
  );
}
