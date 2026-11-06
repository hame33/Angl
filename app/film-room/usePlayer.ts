'use client';
/*
 * The YouTube IFrame player for the film room, as a hook. Unlike the share
 * page's facade, the editor needs the API: it reads the playhead for
 * "↓ current", seeks to a clip, and watches the time to stop or loop it.
 *
 * One player per page, made on first use and reused when the film changes
 * (classic Angl destroyed and rebuilt it, which reset focus and flickered).
 * youtube-nocookie, playsinline so phones don't jump to fullscreen.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

interface YTPlayer {
  loadVideoById(o: { videoId: string; startSeconds?: number }): void;
  cueVideoById(o: { videoId: string; startSeconds?: number }): void;
  seekTo(s: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getVideoData(): { video_id?: string; title?: string; author?: string };
  destroy(): void;
}
declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement, opts: unknown) => YTPlayer; PlayerState: Record<string, number> };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<void> | null = null;
function loadApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (!apiPromise) {
    apiPromise = new Promise(resolve => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.async = true;
      document.head.appendChild(s);
    });
  }
  return apiPromise;
}

export const PLAYING = 1, PAUSED = 2, ENDED = 0;

export interface Player {
  ready: boolean;
  videoId: string | null;
  playing: boolean;
  /* Load a film, optionally seeking and playing once it's ready */
  load(videoId: string, at?: number, play?: boolean): void;
  seek(t: number): void;
  play(): void;
  pause(): void;
  time(): number;
  duration(): number;
  title(): { title: string | null; author: string | null };
}

export function usePlayer(host: React.RefObject<HTMLDivElement | null>, onReadyTitle?: (videoId: string, title: string) => void): Player {
  const player = useRef<YTPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const pending = useRef<{ videoId: string; at?: number; play?: boolean } | null>(null);
  const titled = useRef(onReadyTitle);
  titled.current = onReadyTitle;

  // The film's own title arrives a moment after it loads; ask twice, like classic tryAutoTitle
  const reportTitle = useCallback((vid: string) => {
    const tryIt = () => {
      try {
        const d = player.current?.getVideoData();
        if (d?.video_id === vid && d.title) { titled.current?.(vid, d.title); return true; }
      } catch { /* not ready */ }
      return false;
    };
    if (!tryIt()) setTimeout(tryIt, 1500);
  }, []);

  const load = useCallback((vid: string, at = 0, play = false) => {
    setVideoId(vid);
    const p = player.current;
    if (!p) { pending.current = { videoId: vid, at, play }; return; }
    if (play) p.loadVideoById({ videoId: vid, startSeconds: at });
    else p.cueVideoById({ videoId: vid, startSeconds: at });
    setTimeout(() => reportTitle(vid), 800);
  }, [reportTitle]);

  // Create the player the first time a film is asked for
  useEffect(() => {
    if (!videoId || player.current || !host.current) return;
    let cancelled = false;
    loadApi().then(() => {
      if (cancelled || !host.current || player.current) return;
      const mount = document.createElement('div');
      host.current.replaceChildren(mount);
      const first = pending.current ?? { videoId };
      pending.current = null;
      player.current = new window.YT!.Player(mount, {
        host: 'https://www.youtube-nocookie.com',
        videoId: first.videoId,
        playerVars: { controls: 1, rel: 0, modestbranding: 1, playsinline: 1, start: Math.floor(first.at ?? 0), origin: window.location.origin },
        events: {
          onReady: () => {
            setReady(true);
            if (first.at) player.current?.seekTo(first.at, true);
            if (first.play) player.current?.playVideo();
            reportTitle(first.videoId);
          },
          onStateChange: (e: { data: number }) => setPlaying(e.data === PLAYING),
        },
      });
    });
    return () => { cancelled = true; };
  }, [videoId, host, reportTitle]);

  useEffect(() => () => { try { player.current?.destroy(); } catch { /* already gone */ } player.current = null; }, []);

  const safe = <T,>(f: () => T, fallback: T): T => { try { return player.current ? f() : fallback; } catch { return fallback; } };
  return {
    ready, videoId, playing, load,
    seek: t => safe(() => player.current!.seekTo(Math.max(0, t), true), undefined),
    play: () => safe(() => player.current!.playVideo(), undefined),
    pause: () => safe(() => player.current!.pauseVideo(), undefined),
    time: () => safe(() => player.current!.getCurrentTime() || 0, 0),
    duration: () => safe(() => player.current!.getDuration() || 0, 0),
    title: () => safe(() => { const d = player.current!.getVideoData(); return { title: d.title || null, author: d.author || null }; }, { title: null, author: null }),
  };
}
