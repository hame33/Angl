'use server';
/*
 * Everything the studio changes goes through here. Each action signs in as the
 * current user's session, so Postgres row-level security decides what is
 * allowed (PLAN.md §4) — these checks only make the refusal readable.
 */
import { updateTag, revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { clipUpdateSchema, firstIssue, importBatchSchema } from '@/lib/clip-form';
import { legacyClipId } from '@/lib/legacy/ids';
import { linksFromText } from '@/lib/profile';
import { TAGS } from '@/lib/public-api';
import { clipCacheTag } from '@/lib/shared-clip';
import { site } from '@/lib/site';
import { createClient, currentPublisher } from '@/lib/supabase/server';
import { slugify } from '@/lib/text';
import { bestThumbnail, lookupVideo, type VideoInfo } from '@/lib/youtube-lookup';

export interface FormState { ok: boolean; message: string; shareUrl?: string }

/* ── Sign in / out ────────────────────────────────────────────────────────── */

export async function signIn(_prev: FormState, form: FormData): Promise<FormState> {
  const email = z.email().safeParse(String(form.get('email') ?? '').trim().toLowerCase());
  if (!email.success) return { ok: false, message: 'That doesn’t look like an email address.' };

  // The link must come back to this deployment (local, preview or live)
  const origin = (await headers()).get('origin') || site.url;
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: email.data,
    // Never create an account from this form: publishers are added by hand
    options: { shouldCreateUser: false, emailRedirectTo: `${origin}/auth/confirm` },
  });
  // Rate limits are worth saying; anything else (an unknown address included)
  // gets the same answer, so the form can't be used to probe who has an account.
  if (error && /rate limit|too many/i.test(error.message)) {
    return { ok: false, message: 'Too many sign-in emails just now. Wait a few minutes and try again.' };
  }
  return { ok: true, message: 'If that address can sign in, a link is on its way. Open it on this device.' };
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/studio/login');
}

/* ── Import an Angl export ────────────────────────────────────────────────── */

export interface ImportResult { ok: boolean; message: string; added: number; existing: number }

/*
 * One batch of clips the browser converted from an export file. Each clip's id
 * is a hash of who you are and what the clip is (lib/legacy/ids.ts), and the
 * insert skips ids that already exist — so importing the same file twice adds
 * nothing, and never overwrites notes you have written since.
 */
export async function importClips(batch: unknown): Promise<ImportResult> {
  const { user, isPublisher } = await currentPublisher();
  if (!user) return { ok: false, message: 'You’ve been signed out. Sign in again.', added: 0, existing: 0 };
  if (!isPublisher) return { ok: false, message: 'This account can’t publish.', added: 0, existing: 0 };

  const parsed = importBatchSchema.safeParse(batch);
  if (!parsed.success) return { ok: false, message: 'Part of the file could not be read.', added: 0, existing: 0 };

  const rows = await Promise.all(parsed.data.map(async c => ({
    id: await legacyClipId(user.id, c),
    owner_id: user.id,
    title: c.title,
    youtube_video_id: c.videoId,
    start_seconds: c.startSeconds,
    end_seconds: c.endSeconds,
    marked_start_seconds: c.markedStartSeconds,
    marked_end_seconds: c.markedEndSeconds,
    category: c.category,
    legacy: c.legacy,
    created_via: 'import',
    visibility: 'private' as const,
  })));

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('clips')
    .upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
    .select('id');
  if (error) return { ok: false, message: 'The import was refused: ' + error.message, added: 0, existing: 0 };

  revalidatePath('/studio');
  const added = data?.length ?? 0;
  return { ok: true, message: '', added, existing: rows.length - added };
}

/* ── Edit, publish, unpublish ─────────────────────────────────────────────── */

const fields = ['id', 'title', 'notes', 'coachingPoints', 'tags', 'videoId', 'start', 'end',
  'coachName', 'coachUrl', 'sourceTitle', 'channelName', 'channelUrl', 'visibility'] as const;

export async function saveClip(_prev: FormState, form: FormData): Promise<FormState> {
  const raw = Object.fromEntries(fields.map(f => [f, String(form.get(f) ?? '')]));
  const parsed = clipUpdateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) };
  const c = parsed.data;

  const { user, isPublisher } = await currentPublisher();
  if (!user) return { ok: false, message: 'You’ve been signed out. Sign in again, then save.' };
  if (!isPublisher) return { ok: false, message: 'This account can’t publish.' };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from('clips').select('share_id, thumbnail_url, youtube_video_id').eq('id', c.id).maybeSingle();
  if (!existing) return { ok: false, message: 'That clip no longer exists.' };

  // A shared clip needs a thumbnail that exists, for its page and its link preview
  let thumbnail = existing.thumbnail_url as string | null;
  if (existing.youtube_video_id !== c.videoId) thumbnail = null;
  if (c.visibility !== 'private' && c.videoId && !thumbnail) thumbnail = await bestThumbnail(c.videoId);

  const { error } = await supabase.from('clips').update({
    title: c.title,
    notes: c.notes,
    coaching_points: c.coachingPoints,
    tags: c.tags,
    youtube_video_id: c.videoId,
    start_seconds: c.start,
    end_seconds: c.end,
    credit_coach_name: c.coachName,
    credit_url: c.coachUrl,
    credit_source_title: c.sourceTitle,
    source_channel_name: c.channelName,
    source_channel_url: c.channelUrl,
    thumbnail_url: thumbnail,
    visibility: c.visibility,
  }).eq('id', c.id);
  if (error) return { ok: false, message: 'Not saved: ' + error.message };

  // The public page's cached copy is dropped now, not in five minutes:
  // a publish shows up straight away, and an unpublish stops straight away.
  updateTag(clipCacheTag(existing.share_id as string));
  updateTag(TAGS.library);   // the library, the home page's latest clips and the sitemap
  revalidatePath('/studio');
  revalidatePath(`/studio/clips/${c.id}`);

  const path = `/clips/${existing.share_id}/${slugify(c.title)}`;
  const message = c.visibility === 'private' ? 'Saved. Only you can see it.'
    : c.visibility === 'unlisted' ? 'Saved. Anyone with the link can watch it.'
    : 'Saved and public.';
  return { ok: true, message, shareUrl: c.visibility === 'private' ? undefined : path };
}

/* The video's title and channel, to fill the credit fields. */
export async function fillFromYouTube(videoId: string): Promise<VideoInfo | null> {
  const { isPublisher } = await currentPublisher();
  if (!isPublisher) return null;
  return lookupVideo(videoId);
}

/* ── Your profile: the home page tagline and the about page ───────────────── */

const profileSchema = z.object({
  displayName: z.string().trim().min(1, 'Your name is needed').max(100),
  handle: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{3,30}$/, 'Handle must be 3–30 lower-case letters, numbers or hyphens'),
  tagline: z.string().trim().max(200, 'Keep the tagline under 200 characters'),
  bio: z.string().max(10000).transform(v => v.replace(/\r\n/g, '\n').trim()),
  links: z.string().max(5000).transform(linksFromText),
});

export async function saveProfile(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = profileSchema.safeParse(Object.fromEntries(['displayName', 'handle', 'tagline', 'bio', 'links'].map(f => [f, String(form.get(f) ?? '')])));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Something in the form is not valid.' };
  const { user, isPublisher } = await currentPublisher();
  if (!user) return { ok: false, message: 'You’ve been signed out. Sign in again, then save.' };
  if (!isPublisher) return { ok: false, message: 'This account can’t publish.' };

  const p = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from('profiles').upsert({
    id: user.id, handle: p.handle, display_name: p.displayName, tagline: p.tagline, bio: p.bio, links: p.links,
  }, { onConflict: 'id' });
  if (error) {
    return { ok: false, message: error.code === '23505' ? 'That handle is taken.' : 'Not saved: ' + error.message };
  }
  updateTag(TAGS.profile);
  revalidatePath('/studio/profile');
  return { ok: true, message: 'Saved. The home and about pages are updated.' };
}
