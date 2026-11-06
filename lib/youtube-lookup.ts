/*
 * Server-side YouTube lookups made at publish time, never on a visitor's
 * request. Both use public endpoints that need no API key, and both fail soft:
 * a slow or missing answer must never stop a clip being saved.
 */
import { isVideoId, watchUrl } from './youtube.ts';

const TIMEOUT_MS = 4000;

export interface VideoInfo { sourceTitle: string | null; channelName: string | null; channelUrl: string | null }

/* oEmbed gives the video's title and the uploading channel. It does not know
 * who the coach is, so that field is always left to you. */
export async function lookupVideo(videoId: string): Promise<VideoInfo | null> {
  if (!isVideoId(videoId)) return null;
  const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl(videoId))}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' });
    if (!res.ok) return null;   // 401: embedding disabled; 404: private or removed
    const d = await res.json() as Record<string, unknown>;
    const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const channelUrl = s(d.author_url);
    return {
      sourceTitle: s(d.title),
      channelName: s(d.author_name),
      channelUrl: channelUrl && /^https:\/\//.test(channelUrl) ? channelUrl : null,
    };
  } catch {
    return null;
  }
}

/*
 * The best thumbnail that exists. maxresdefault (1280×720) is missing for
 * some uploads and YouTube answers 404; hqdefault always exists. Stored on the
 * clip so a link preview never points at a missing image.
 */
export async function bestThumbnail(videoId: string): Promise<string> {
  const hq = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  if (!isVideoId(videoId)) return hq;
  const maxres = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
  try {
    const res = await fetch(maxres, { method: 'HEAD', signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' });
    return res.ok ? maxres : hq;
  } catch {
    return hq;
  }
}
