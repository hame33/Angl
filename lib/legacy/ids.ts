/*
 * Name-based UUIDs (RFC 9562 version 5: SHA-1 of a namespace plus a name).
 * The same clip imported twice — or from a second machine's copy of the same
 * library — gets the same id, so re-importing can never duplicate a clip.
 *
 * Web Crypto, so it runs unchanged in the browser (Phase 4) and on the server.
 */

// Fixed for Angl's legacy imports. Never change it: every imported clip's id depends on it.
export const LEGACY_CLIP_NAMESPACE = '6f1d0b8e-3c5a-4e7f-9b2d-1a4c8e6f0d3b';

function uuidBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error('not a uuid: ' + uuid);
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function uuidV5(name: string, namespace: string): Promise<string> {
  const ns = uuidBytes(namespace);
  const text = new TextEncoder().encode(name);
  const buf = new Uint8Array(ns.length + text.length);
  buf.set(ns);
  buf.set(text, ns.length);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', buf)).slice(0, 16);
  hash[6] = (hash[6]! & 0x0f) | 0x50;   // version 5
  hash[8] = (hash[8]! & 0x3f) | 0x80;   // RFC variant
  const h = [...hash].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/*
 * The owner is part of the name: two coaches importing the same shared
 * library must get different rows, not collide on one primary key. The film
 * and times are too, because classic Angl's 7-character ids are only unique
 * within one browser.
 */
export function legacyClipId(ownerId: string, c: { legacyId: string; videoId: string | null; startSeconds: number; endSeconds: number }): Promise<string> {
  return uuidV5([ownerId, c.legacyId, c.videoId ?? '', c.startSeconds, c.endSeconds].join('|'), LEGACY_CLIP_NAMESPACE);
}
