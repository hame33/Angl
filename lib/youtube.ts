/*
 * YouTube, embed-only. Angl never downloads or re-hosts video: everything here
 * builds a URL that YouTube itself serves.
 */

const VIDEO_ID = /^[A-Za-z0-9_-]{6,20}$/;

export function isVideoId(id: unknown): id is string {
  return typeof id === 'string' && VIDEO_ID.test(id);
}

/*
 * The embed's own start/end parameters take whole seconds. Round outward so the
 * clip is never cut short: a clip marked 12.5 → 20.5 plays 12 → 21.
 */
export function clipWindow(startSeconds: number, endSeconds: number): { start: number; end: number } {
  const start = Math.max(0, Math.floor(startSeconds));
  const end = Math.max(start + 1, Math.ceil(endSeconds));
  return { start, end };
}

/*
 * youtube-nocookie keeps YouTube's tracking cookies off until the visitor
 * actually plays, which matters on a page whose analytics are cookieless.
 * playsinline stops iOS jumping to fullscreen; rel=0 keeps the end card to
 * the same channel.
 */
export function embedUrl(videoId: string, startSeconds: number, endSeconds: number, autoplay: boolean): string {
  const { start, end } = clipWindow(startSeconds, endSeconds);
  const params = new URLSearchParams({
    start: String(start),
    end: String(end),
    playsinline: '1',
    rel: '0',
    modestbranding: '1',
  });
  if (autoplay) params.set('autoplay', '1');
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?${params}`;
}

/* The full source video on YouTube, opened at the clip. */
export function watchUrl(videoId: string, startSeconds = 0): string {
  const t = Math.max(0, Math.floor(startSeconds));
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}${t ? `&t=${t}s` : ''}`;
}

export interface Thumbnail { url: string; width: number; height: number }

/*
 * maxresdefault (1280×720) exists for most HD uploads but not all;
 * hqdefault (480×360) always exists. A clip stores whichever was checked at
 * publish time; this is the fallback when nothing was stored.
 */
export function thumbnailFor(videoId: string, stored: string | null): Thumbnail {
  if (stored && /^https:\/\/i\.ytimg\.com\//.test(stored)) {
    const maxres = /\/maxresdefault\.jpg$/.test(stored);
    return { url: stored, width: maxres ? 1280 : 480, height: maxres ? 720 : 360 };
  }
  return { url: `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`, width: 480, height: 360 };
}

/*
 * A pasted link → a YouTube video id, or null. Only YouTube's own hosts
 * count: "?v=" on some other site is not a YouTube video. Accepts the forms
 * coaches actually paste — watch, youtu.be, shorts, embed, live, mobile — with
 * or without the https:// in front. A bare 11-character id works too.
 */
const YT_HOSTS = /^(?:www\.|m\.|music\.)?(?:youtube\.com|youtube-nocookie\.com)$/i;
export function parseVideoUrl(input: string): string | null {
  const text = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(text)) return text;
  let url: URL;
  try { url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`); } catch { return null; }
  const host = url.hostname.toLowerCase();
  let id: string | null = null;
  if (host === 'youtu.be') id = url.pathname.split('/')[1] ?? null;
  else if (YT_HOSTS.test(host)) {
    id = url.searchParams.get('v') ?? /^\/(?:embed|shorts|live|v)\/([^/?#]+)/.exec(url.pathname)?.[1] ?? null;
  }
  return isVideoId(id) ? id : null;
}
