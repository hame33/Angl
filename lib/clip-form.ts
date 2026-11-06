/*
 * The studio's clip editor, as data: what the form sends, how each field is
 * cleaned, and what is refused. Shared by the server action (the trust
 * boundary) and the tests. zod is here because this is user input headed for
 * the database, and later for a language model to read back (PLAN.md §2).
 */
import { z } from 'zod';
import { isVideoId } from './youtube.ts';

/* "1:49" → 109, "1:02:03" → 3723, "109" → 109, "1:49.5" → 109.5. A bare
 * number is seconds here: this field is typed, not dictated. */
export function parseClock(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(t);
  if (!m) return null;
  const [, h, min, sec] = m;
  if (Number(sec) >= 60 || (h !== undefined && Number(min) >= 60)) return null;
  return Number(h ?? 0) * 3600 + Number(min) * 60 + Number(sec);
}

/* "Defence, closeouts ,DEFENCE" → ["defence", "closeouts"]. Lower-case and
 * de-duplicated, so a tag filter (Phase 3) never sees two spellings. */
export function parseTags(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(',')) {
    const t = raw.trim().toLowerCase().replace(/\s+/g, ' ');
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/* One coaching point per line; blank lines and stray bullets dropped. */
export function parseLines(text: string): string[] {
  return text.split('\n').map(l => l.replace(/^\s*[-•*]\s*/, '').trim()).filter(Boolean);
}

const httpsOrEmpty = z.string().trim().max(500)
  .refine(v => v === '' || /^https:\/\/[^\s]+$/.test(v), 'must start with https://')
  .transform(v => v || null);
const optionalText = (max: number) => z.string().trim().max(max).transform(v => v || null);

export const clipUpdateSchema = z.object({
  id: z.uuid(),
  title: z.string().trim().min(1, 'needs a title').max(200),
  notes: z.string().max(20000).transform(v => v.replace(/\r\n/g, '\n').trim()),
  coachingPoints: z.string().max(10000).transform(parseLines)
    .pipe(z.array(z.string().max(300, 'a coaching point is over 300 characters')).max(30, 'at most 30 coaching points')),
  tags: z.string().max(1000).transform(parseTags)
    .pipe(z.array(z.string().max(40, 'a tag is over 40 characters')).max(20, 'at most 20 tags')),
  videoId: z.string().trim().transform(v => v || null)
    .refine(v => v === null || isVideoId(v), 'is not a YouTube video id'),
  start: z.string().transform((v, ctx) => {
    const n = parseClock(v);
    if (n === null) { ctx.addIssue({ code: 'custom', message: 'start is not a time like 1:49' }); return z.NEVER; }
    return Math.round(n * 100) / 100;
  }),
  end: z.string().transform((v, ctx) => {
    const n = parseClock(v);
    if (n === null) { ctx.addIssue({ code: 'custom', message: 'end is not a time like 2:23' }); return z.NEVER; }
    return Math.round(n * 100) / 100;
  }),
  coachName: optionalText(100),
  coachUrl: httpsOrEmpty,
  sourceTitle: optionalText(300),
  channelName: optionalText(100),
  channelUrl: httpsOrEmpty,
  visibility: z.enum(['private', 'unlisted', 'public']),
})
  .refine(c => c.end > c.start, { message: 'the end must be after the start', path: ['end'] })
  .refine(c => c.end - c.start <= 600, { message: 'a clip can be at most 10 minutes', path: ['end'] })
  .refine(c => c.visibility === 'private' || c.videoId !== null, {
    message: 'a clip needs a YouTube video before it can be shared', path: ['videoId'],
  });

export type ClipUpdate = z.infer<typeof clipUpdateSchema>;

/* The first problem, said plainly, for the form's status line. */
export function firstIssue(err: z.ZodError): string {
  const i = err.issues[0];
  if (!i) return 'Something in the form is not valid.';
  const field = i.path[0];
  const label = typeof field === 'string' ? field.replace(/([A-Z])/g, ' $1').toLowerCase() : '';
  return /^(the|a|at most|start|end)\b/.test(i.message) || !label ? capital(i.message) : `${capital(label)} ${i.message}`;
}
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/* The import action's input: what lib/legacy/convert.ts produced in the
 * browser, re-checked here because the browser can send anything. */
export const importedClipSchema = z.object({
  legacyId: z.string().min(1).max(100),
  title: z.string().trim().min(1).max(200),
  videoId: z.string().nullable().transform(v => (v && isVideoId(v) ? v : null)),
  startSeconds: z.number().finite().min(0).max(86400),
  endSeconds: z.number().finite().min(0).max(86400),
  markedStartSeconds: z.number().finite().nullable(),
  markedEndSeconds: z.number().finite().nullable(),
  category: z.string().max(200).nullable(),
  legacy: z.object({
    id: z.string().max(100),
    index: z.number().int().min(0),
    gameId: z.string().max(100).nullable(),
    playlistId: z.string().max(100).nullable(),
    gameTitle: z.string().max(300).nullable(),
    teamName: z.string().max(200).nullable(),
    sport: z.string().max(40).nullable(),
    categoryEmoji: z.string().max(16).nullable(),
  }),
}).refine(c => c.endSeconds > c.startSeconds, 'end must be after start');

export const IMPORT_BATCH = 200;
export const importBatchSchema = z.array(importedClipSchema).min(1).max(IMPORT_BATCH);
