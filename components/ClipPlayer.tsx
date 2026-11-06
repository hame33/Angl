'use client';

import Image from 'next/image';
import { useState } from 'react';
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

/*
 * A facade: the page ships a thumbnail and a button, and YouTube's player
 * (around a megabyte of script) only loads when someone taps play. That is
 * what keeps a share page fast on a phone arriving from Substack.
 *
 * The embed's own start/end parameters stop the clip, so there is no polling
 * here. Replay remounts the iframe, which restarts at `start` without loading
 * the IFrame API.
 */
export function ClipPlayer({ shareId, videoId, startSeconds, endSeconds, title, thumbnail }: Props) {
  const [run, setRun] = useState(0);   // 0 = not started; each replay bumps it

  function play() {
    setRun(r => r + 1);
    try { window.umami?.track(run ? 'clip_replay' : 'clip_play', { shareId }); } catch { /* analytics never breaks playback */ }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.frame}>
        {run === 0 ? (
          <button type="button" className={styles.facade} onClick={play} aria-label={`Play clip: ${title}`}>
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
        ) : (
          <iframe
            key={run}
            src={embedUrl(videoId, startSeconds, endSeconds, true)}
            title={title}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        )}
      </div>
      {run > 0 && (
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
