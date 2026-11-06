-- Angl 0001: profiles, publishers, clips, and the public read path for clip
-- share pages. See PLAN.md §2 and §4.
--
-- Access in one paragraph: an owner has full access to their own clips; anyone
-- (signed in or not) can read clips marked 'public'; 'unlisted' clips are never
-- listable and are reachable only through get_shared_clip(share_id); writes also
-- require a row in `publishers`, which is what keeps this phase single-publisher
-- even if sign-ups are ever left open.

create type public.visibility as enum ('private', 'unlisted', 'public');

-- 11-character URL-safe id from 64 random bits: unguessable enough for an
-- unlisted link, short enough to read aloud.
create function public.new_share_id() returns text
  language sql volatile
  set search_path = ''
as $$
  select translate(encode(extensions.gen_random_bytes(8), 'base64'), '+/=', '-_')
$$;

create function public.touch_updated_at() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- ── Publishers ──────────────────────────────────────────────────────────────
-- Who may write. One row (you) for now; dropping the check from the write
-- policies is what opens Angl to more accounts later.
create table public.publishers (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.publishers enable row level security;
create policy publishers_read_own on public.publishers
  for select to authenticated
  using (user_id = (select auth.uid()));

create function public.is_publisher() returns boolean
  language sql stable security definer
  set search_path = ''
as $$
  select exists (select 1 from public.publishers where user_id = (select auth.uid()))
$$;

-- ── Profiles ────────────────────────────────────────────────────────────────
-- Public by design: it is the source of the site's about page and credit lines.
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  handle        text not null unique check (handle ~ '^[a-z0-9-]{3,30}$'),
  display_name  text not null check (char_length(display_name) between 1 and 100),
  bio           text not null default '' check (char_length(bio) <= 10000),
  substack_url  text,
  links         jsonb not null default '[]' check (jsonb_typeof(links) = 'array'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
alter table public.profiles enable row level security;
create policy profiles_read on public.profiles
  for select to anon, authenticated using (true);
create policy profiles_insert_own on public.profiles
  for insert to authenticated
  with check (id = (select auth.uid()) and (select public.is_publisher()));
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()) and (select public.is_publisher()));

-- ── Clips ───────────────────────────────────────────────────────────────────
-- start/end are the range PLAYED (classic Angl's effStart/effEnd); the marked
-- moment is kept alongside so the editor can show the buffers.
create table public.clips (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid not null default auth.uid() references auth.users(id) on delete cascade,
  share_id             text not null unique default public.new_share_id(),
  visibility           public.visibility not null default 'private',
  title                text not null check (char_length(title) between 1 and 200),
  tags                 text[] not null default '{}',
  youtube_video_id     text check (youtube_video_id ~ '^[A-Za-z0-9_-]{6,20}$'),
  start_seconds        numeric(9,2) not null check (start_seconds >= 0),
  end_seconds          numeric(9,2) not null,
  marked_start_seconds numeric(9,2),
  marked_end_seconds   numeric(9,2),
  notes                text not null default '' check (char_length(notes) <= 20000),
  coaching_points      text[] not null default '{}',
  credit_coach_name    text,
  credit_url           text check (credit_url ~ '^https://'),
  credit_source_title  text,
  thumbnail_url        text check (thumbnail_url ~ '^https://i\.ytimg\.com/'),
  category             text,
  legacy               jsonb,
  created_via          text not null default 'manual' check (created_via in ('manual', 'import', 'ai')),
  published_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint clip_range       check (end_seconds > start_seconds),
  constraint clip_publishable check (visibility = 'private' or youtube_video_id is not null)
);
create trigger clips_touch before update on public.clips
  for each row execute function public.touch_updated_at();

-- The first time a clip leaves 'private' is its publish date, and it keeps it.
create function public.stamp_published_at() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.visibility <> 'private' and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end
$$;
create trigger clips_stamp_published before insert or update on public.clips
  for each row execute function public.stamp_published_at();

create index clips_tags_gin on public.clips using gin (tags);
create index clips_public   on public.clips (published_at desc) where visibility = 'public';
create index clips_owner    on public.clips (owner_id, updated_at);
create unique index clips_owner_legacy on public.clips (owner_id, (legacy->>'id')) where legacy is not null;

alter table public.clips enable row level security;
-- One select policy rather than two permissive ones, so Postgres evaluates once
create policy clips_read on public.clips
  for select to anon, authenticated
  using (visibility = 'public' or owner_id = (select auth.uid()));
create policy clips_insert on public.clips
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select public.is_publisher()));
create policy clips_update on public.clips
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and (select public.is_publisher()));
create policy clips_delete on public.clips
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- ── Share page read path ────────────────────────────────────────────────────
-- Public or unlisted, by share id, as a curated payload: no owner id, no
-- legacy ids, nothing the page doesn't print. Private and unknown ids both
-- return null, so a page cannot tell "private" from "doesn't exist".
create function public.get_shared_clip(p_share_id text) returns jsonb
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
                        'sourceTitle', c.credit_source_title),
    'thumbnailUrl',   c.thumbnail_url,
    'publishedAt',    c.published_at,
    'updatedAt',      c.updated_at
  )
  from public.clips c
  where c.share_id = p_share_id
    and c.visibility in ('public', 'unlisted')
$$;
revoke execute on function public.get_shared_clip(text) from public;
grant execute on function public.get_shared_clip(text) to anon, authenticated;
