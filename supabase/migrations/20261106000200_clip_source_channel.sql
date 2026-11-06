-- The coach in a clip and the channel that uploaded it are often different
-- people: a John Calipari practice filmed and posted by HawgBeat.com. Credit
-- both. credit_coach_name/credit_url stay the coach; these are the uploader,
-- as YouTube's oEmbed reports them (author_name, author_url).
alter table public.clips
  add column source_channel_name text,
  add column source_channel_url  text check (source_channel_url ~ '^https://');

create or replace function public.get_shared_clip(p_share_id text) returns jsonb
  language sql stable security definer
  set search_path = ''
as $$
  select jsonb_build_object(
    'shareId',        c.share_id,
    'visibility',     c.visibility,
    'title',          c.title,
    'tags',           to_jsonb(c.tags),
    'notes',          c.notes,
    'coachingPoints', to_jsonb(c.coaching_points),
    'video',          jsonb_build_object('provider', 'youtube', 'videoId', c.youtube_video_id),
    'startSeconds',   c.start_seconds,
    'endSeconds',     c.end_seconds,
    'credit',         jsonb_build_object(
                        'coachName',   c.credit_coach_name,
                        'url',         c.credit_url,
                        'sourceTitle', c.credit_source_title,
                        'channelName', c.source_channel_name,
                        'channelUrl',  c.source_channel_url),
    'thumbnailUrl',   c.thumbnail_url,
    'publishedAt',    c.published_at,
    'updatedAt',      c.updated_at
  )
  from public.clips c
  where c.share_id = p_share_id
    and c.visibility in ('public', 'unlisted')
$$;
