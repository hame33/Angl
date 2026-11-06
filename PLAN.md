# Angl → coaching site: plan

Status: **draft for review. No code has been written.** Items marked **⚑ Unsure** are
questions I could not settle from the repo. They need an answer or a deliberate default
before the phase that depends on them.

---

## 1. Current state

### What Angl does today

Angl is a single `index.html` (≈4,900 lines, ≈210 KB: about 900 lines of CSS, 300 of markup
and 3,650 of vanilla JS). It has no build step and no dependencies. `serve.sh` serves it with
`python3 -m http.server` on **port 8777**.

- **Library shape:** team → game → playlist → clip.
  - A *team* has a sport (basketball or netball). The sport drives the default categories,
    the dictation vocabulary and the emoji palette.
  - A *game* is a title plus one YouTube video id.
  - A *playlist* belongs to exactly one game. Playlists with the same name in different games
    roll up into a cross-game "category" on the dashboard.
- **Clip editor:** an embedded YouTube IFrame player (`youtube-nocookie.com`). You set start
  and end by hand or with "↓ current", plus per-clip buffers (0–15 s before and after).
  - The clip end is enforced by polling `getCurrentTime()` every 500 ms (150 ms in
    play-all), so playback can overshoot the end by up to that interval.
  - Also: loop, play-all across games, and a free-scrub mode.
- **Dictation:**
  - Hold a hotkey and speak. The Web Speech API transcribes the session.
  - A hand-written timestamp parser (`wordsToDigits`, `findTimestamp`, …) turns the
    transcript into one pending clip, which you confirm on a card.
  - A sport's "protected phrases" stop wording like "long two" from being read as a length.
  - There is an optional bring-your-own-key LLM parser (Anthropic or OpenAI-compatible),
    called straight from the browser.
- **Clip-length model:** medians per category and per word, learned from the coach's own
  clips, with a 1,000-clip backfill on first run.
- **Dictation log:** keeps what was heard, what was parsed and what was kept, so a future
  parser can be trained on it. Nothing reads it yet.
- **Export/Import:** a JSON file (`version: 4`). Import replaces the whole library.
- **`clip_downloader.py`:** reads the export and uses **yt-dlp + ffmpeg to download the
  source video and cut MP4s locally.** See ⚑ D1.
- **Tests:** 102 Node tests (parser, durations, migrations, sport profiles, dictation log)
  and 69 Python tests (downloader logic). The Node tests pull the `<script>` block out of
  `index.html` and run it in a `vm` sandbox with a fake DOM and fake storage
  (`tests/load-app.mjs`). CI runs both suites on every push.

### How data is stored

All data is in `localStorage` on the serving origin. The keys are:

| Key | Contents |
|---|---|
| `filmroom_clips` | `Clip[]`: `{id, label, videoId, gameId, playlistId, start, end, bufBefore, bufAfter, effStart, effEnd}`. There are no timestamps, notes or tags. |
| `filmroom_playlists` | `{id, gameId, name, emoji}[]` |
| `filmroom_games` | `{id, teamId, title, videoId, createdAt(ms), autoTitle}[]` |
| `filmroom_teams` | `{id, name, sport?, createdAt(ms)}[]`. A missing `sport` means basketball. |
| `filmroom_active_game`, `filmroom_active_team`, `filmroom_video` | UI state. `filmroom_video` is also the pre-games migration input. |
| `filmroom_duration_model` | Clip-length model. |
| `filmroom_dictation_log` | Transcripts and their outcomes. It can reach several MB. |
| `filmroom_settings` | Parser choice, LLM endpoint, model and **API key in plain text**. |
| `filmroom_hotkey` | Dictation key. |
| `<key>_corrupt` | A verbatim copy of any key that failed to parse. |

There are two in-place migrations (`migrateToGames`, then `migrateToTeams`) for libraries
saved before games and teams existed. Both are well tested.

### What is fragile

1. **Storage is tied to the origin.** Clips exist only at `http://localhost:8777` in one
   browser on one machine. **A hosted Next.js app on any other origin cannot read
   these keys.** The requirement to "read existing `filmroom_` keys on first load" can only
   be met when the new app is served from that same origin (§3 deals with this).
2. **5 MB quota, shared.** The clips, the model and a log of up to 2 MB or more share one
   quota. A save that fails leaves clips only in memory. The app warns about this, but it is
   still the main way data gets lost.
3. **Ids are weak.** `uid()` is `Math.random().toString(36).slice(2, 9)`: 7 characters, not
   globally unique. Two machines' libraries can collide on import.
4. **Clips have no timestamps.** Creation order is only array order, and import replaces
   the library rather than merging it.
5. **Derived fields are stored.** `effStart` and `effEnd` are stored alongside
   `start`/`end`/buffers and can disagree with them.
6. **API key in localStorage.** It is sent from the browser using
   `anthropic-dangerous-direct-browser-access`. That is acceptable for a local tool and not
   acceptable for anything synced or hosted.
7. **HTML built with `innerHTML` and inline `onclick` strings.** Ids and emoji from an
   imported file are put into markup without escaping, which is an injection path (I've
   queued it as a separate task). The new app must not copy this pattern.
8. **Desktop-first layout.** It is a three-column film room with a single 900 px breakpoint
   and a keyboard hotkey for dictation. It is not usable on a phone today.
9. **The tests are tied to the file's shape.** They depend on one `<script>` block in
   `index.html`. They keep working only as long as `index.html` stays as it is.
10. **The downloader reads export v4.** Any change to the export format breaks
    `clip_downloader.py`.

---

## 2. Data model

### Principles

- **The same shape everywhere.** The TypeScript types, the JSON export, the API payloads and
  the future LLM tool schemas all describe the same objects. They are camelCase in JSON and
  snake_case in Postgres, with one mapping layer (`lib/model/db.ts`).
- **Units are in the field names** (`startSeconds`, `durationMinutes`). There are no derived
  fields except where Postgres generates them.
- **References are plain uuids** (`drillId`, `clipId`). A dangling reference renders as
  "item removed" and does not crash.
- **Session blocks are an ordered JSON array inside the plan**, not a child table. A plan is
  one document that an LLM can read or write in one go, that syncs as one unit, and whose
  reorder is one update. Finding where a drill is used still works with a GIN index on
  `blocks` (`blocks @> '[{"drillId":"…"}]'`).
- **Runtime validation with zod** at every boundary: import, API, sync and later AI output.
  The same zod schemas produce the JSON Schema used for LLM tool definitions.

### Supporting entities you didn't list

To convert existing libraries without losing anything, the model needs two more entities:

- **`Team`**: the legacy team, with its sport.
- **`Film`**: the legacy "game", meaning one YouTube video. It also holds the per-game
  playlist list as `categories`, so empty categories survive, as the current migrations
  guarantee.

A clip's playlist becomes `clip.category` (a name). The cross-game category rollup still
works by name.

### TypeScript types (`lib/model/types.ts`)

```ts
export type Uuid = string;
export type IsoDateTime = string;          // "2026-11-06T09:30:00.000Z"
export type IsoDate = string;              // "2026-11-12"
export type Visibility = 'private' | 'unlisted' | 'public';
export type CreatedVia = 'manual' | 'import' | 'ai';

/** Fields every library item shares. */
export interface LibraryItemBase {
  id: Uuid;
  ownerId: Uuid | null;        // null while local-only (signed out, never synced)
  shareId: string | null;      // short unguessable id for share URLs; set on first sync
  visibility: Visibility;      // private: owner only · unlisted: anyone with the link · public: listed
  title: string;
  tags: string[];              // lower-case, trimmed, de-duplicated
  createdVia: CreatedVia;      // provenance; 'ai' drafts are always created private
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;      // last-write-wins sync key
  publishedAt: IsoDateTime | null; // first time it left 'private'
}

export interface Team {
  id: Uuid; ownerId: Uuid | null;
  name: string;
  sport: 'basketball' | 'netball';   // legacy SPORT_PROFILES keys
  createdAt: IsoDateTime; updatedAt: IsoDateTime;
  legacyId: string | null;
}

export interface Film {
  id: Uuid; ownerId: Uuid | null;
  teamId: Uuid | null;
  title: string;
  video: { provider: 'youtube'; videoId: string | null };
  categories: { name: string; emoji: string }[];   // legacy playlists of this game, in order
  createdAt: IsoDateTime; updatedAt: IsoDateTime;
  legacyId: string | null;
}

export interface Clip extends LibraryItemBase {
  kind: 'clip';
  video: { provider: 'youtube'; videoId: string | null }; // null only for unplayable legacy clips; must be set to publish
  startSeconds: number;        // first second PLAYED (legacy effStart)
  endSeconds: number;          // last second PLAYED (legacy effEnd); > startSeconds
  markedStartSeconds: number | null; // the moment the coach marked (legacy start); buffers = marked − played
  markedEndSeconds: number | null;
  notes: string;               // the coach's notes, plain text with line breaks (⚑ D7)
  coachingPoints: string[];    // short bullets, e.g. "Sprint to the nail"
  credit: {
    coachName: string | null;  // who made the source video, e.g. YouTube channel name
    url: string | null;        // their channel or site
    sourceTitle: string | null;// the source video's title
  };
  thumbnailUrl: string | null; // resolved once at publish time (maxres if it exists, else hq)
  filmId: Uuid | null;
  category: string | null;     // legacy playlist name within the film
  legacy: { id: string; gameId: string | null; playlistId: string | null; index: number } | null;
}

/** Court diagrams use metres on a FIBA half court (⚑ D6). */
export interface Diagram {
  id: Uuid;
  court: 'half';               // 'full' later; the coordinate system doesn't change
  // Origin is the baseline-left corner, x along the baseline (0–15), y toward halfway (0–14).
  // The basket is at (7.5, 1.575).
  elements: DiagramElement[];
  caption: string;
}
export type DiagramElement =
  | { id: string; type: 'player'; x: number; y: number; side: 'offense' | 'defense'; label: string } // label "1"–"5", "X1"…
  | { id: string; type: 'coach';  x: number; y: number; label: string }
  | { id: string; type: 'cone';   x: number; y: number }
  | { id: string; type: 'ball';   x: number; y: number; holderId: string | null }
  | { id: string; type: 'path';   action: 'cut' | 'pass' | 'dribble' | 'screen' | 'handoff';
      points: { x: number; y: number }[]; fromId: string | null; toId: string | null; step: number } // step = order in the sequence
  | { id: string; type: 'text';   x: number; y: number; text: string };

export interface Drill extends LibraryItemBase {
  kind: 'drill';
  summary: string;             // one line
  description: string;         // how to run it
  durationMinutes: number;     // typical length
  players: { min: number | null; max: number | null };
  equipment: string[];
  coachingPoints: string[];
  progressions: string[];
  diagrams: Diagram[];
  clipIds: Uuid[];             // example footage
}

export type SessionBlock =
  | { id: string; type: 'drill';   durationMinutes: number; drillId: Uuid; notes: string; title: string | null } // title overrides the drill's
  | { id: string; type: 'clip';    durationMinutes: number; clipId: Uuid;  notes: string; title: string | null }
  | { id: string; type: 'note';    durationMinutes: number; title: string | null; body: string }
  | { id: string; type: 'diagram'; durationMinutes: number; title: string | null; diagram: Diagram; notes: string }
  | { id: string; type: 'break';   durationMinutes: number; title: string | null }; // "Water"

export interface SessionPlan extends LibraryItemBase {
  kind: 'plan';
  sessionDate: IsoDate | null;
  teamId: Uuid | null;
  objectives: string[];
  notes: string;
  blocks: SessionBlock[];      // array order is run order
  totalMinutes: number;        // derived: sum of blocks[].durationMinutes (generated column server-side)
}

/** Export file. It continues the legacy versioning: legacy is 1–4, this is 5. */
export interface LibraryExport {
  format: 'angl.library';
  version: 5;
  exportedAt: IsoDateTime;
  teams: Team[]; films: Film[]; clips: Clip[]; drills: Drill[]; plans: SessionPlan[];
  durationModel: unknown;      // passed through unchanged
  dictationLog: unknown[];     // passed through unchanged
}
```

Example of a plan as an LLM would read or write it:

```json
{
  "kind": "plan", "title": "U16 Girls — closeouts & transition", "visibility": "private",
  "sessionDate": "2026-11-12", "objectives": ["Close out under control", "Sprint back in transition"],
  "tags": ["defence", "transition"], "notes": "",
  "blocks": [
    { "id": "b1", "type": "drill", "durationMinutes": 10, "drillId": "9f1c…", "notes": "", "title": null },
    { "id": "b2", "type": "clip",  "durationMinutes": 3,  "clipId": "2a7d…", "notes": "Watch the high hands", "title": null },
    { "id": "b3", "type": "break", "durationMinutes": 2,  "title": "Water" }
  ]
}
```

### Postgres schema (`supabase/migrations/0001_init.sql`, sketch)

```sql
create type public.visibility as enum ('private', 'unlisted', 'public');

-- 11-char URL-safe id, ~64 bits: unguessable enough for unlisted links
create function public.new_share_id() returns text language sql volatile as $$
  select translate(encode(extensions.gen_random_bytes(8), 'base64'), '+/=', '-_')
$$;

create function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create table public.profiles (            -- one row per account; also the public site's "about" source
  id            uuid primary key references auth.users(id) on delete cascade,
  handle        text not null unique check (handle ~ '^[a-z0-9-]{3,30}$'),
  display_name  text not null,
  bio           text not null default '',
  substack_url  text,
  links         jsonb not null default '[]',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null, sport text not null default 'basketball',
  legacy_id text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (owner_id, legacy_id)
);

create table public.films (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  team_id uuid references public.teams(id) on delete set null,
  title text not null,
  youtube_video_id text check (youtube_video_id ~ '^[A-Za-z0-9_-]{6,20}$'),
  categories jsonb not null default '[]' check (jsonb_typeof(categories) = 'array'),
  legacy_id text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (owner_id, legacy_id)
);

create table public.clips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  share_id text not null unique default public.new_share_id(),
  visibility public.visibility not null default 'private',
  title text not null check (char_length(title) between 1 and 200),
  tags text[] not null default '{}',
  youtube_video_id text check (youtube_video_id ~ '^[A-Za-z0-9_-]{6,20}$'),
  start_seconds numeric(9,2) not null check (start_seconds >= 0),
  end_seconds   numeric(9,2) not null,
  marked_start_seconds numeric(9,2), marked_end_seconds numeric(9,2),
  notes text not null default '' check (char_length(notes) <= 20000),
  coaching_points text[] not null default '{}',
  credit_coach_name text, credit_url text, credit_source_title text,
  thumbnail_url text,
  film_id uuid references public.films(id) on delete set null,
  category text,
  legacy jsonb,
  created_via text not null default 'manual' check (created_via in ('manual','import','ai')),
  published_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint clip_range       check (end_seconds > start_seconds),
  constraint clip_publishable check (visibility = 'private' or youtube_video_id is not null)
);

create table public.drills (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  share_id text not null unique default public.new_share_id(),
  visibility public.visibility not null default 'private',
  title text not null check (char_length(title) between 1 and 200),
  tags text[] not null default '{}',
  summary text not null default '', description text not null default '',
  duration_minutes numeric(5,1) not null default 10 check (duration_minutes >= 0),
  players_min int check (players_min >= 0), players_max int check (players_max >= players_min),
  equipment text[] not null default '{}', coaching_points text[] not null default '{}',
  progressions text[] not null default '{}',
  diagrams jsonb not null default '[]' check (jsonb_typeof(diagrams) = 'array'),
  clip_ids uuid[] not null default '{}',
  created_via text not null default 'manual' check (created_via in ('manual','import','ai')),
  published_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create function public.plan_total_minutes(blocks jsonb) returns numeric
  language sql immutable as $$
  select coalesce(sum((b->>'durationMinutes')::numeric), 0) from jsonb_array_elements(blocks) b
$$;

create table public.session_plans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  share_id text not null unique default public.new_share_id(),
  visibility public.visibility not null default 'private',
  title text not null check (char_length(title) between 1 and 200),
  tags text[] not null default '{}',
  session_date date,
  team_id uuid references public.teams(id) on delete set null,
  objectives text[] not null default '{}',
  notes text not null default '',
  blocks jsonb not null default '[]' check (jsonb_typeof(blocks) = 'array'),
  total_minutes numeric generated always as (public.plan_total_minutes(blocks)) stored,
  created_via text not null default 'manual' check (created_via in ('manual','import','ai')),
  published_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

-- Indexes: tags, the public library listing, and the "where is this drill used" lookup
create index clips_tags_gin  on public.clips  using gin (tags);
create index drills_tags_gin on public.drills using gin (tags);
create index plans_tags_gin  on public.session_plans using gin (tags);
create index plans_blocks_gin on public.session_plans using gin (blocks jsonb_path_ops);
create index clips_public  on public.clips  (published_at desc) where visibility = 'public';
create index drills_public on public.drills (published_at desc) where visibility = 'public';
create index plans_public  on public.session_plans (published_at desc) where visibility = 'public';
create index clips_owner on public.clips (owner_id, updated_at);   -- sync pulls
create unique index clips_owner_legacy on public.clips (owner_id, (legacy->>'id')) where legacy is not null;
-- + a touch_updated_at trigger on every table
```

The block JSON is checked by zod on write, through the API or an RPC. Postgres only enforces
that `blocks` is an array. Writing a JSON-schema check in SQL is possible but not worth it yet.

---

## 3. Migration: `index.html` → Next.js without breaking anyone

### Layout: the classic app stays and the new app sits beside it

```
index.html, serve.sh, clip_downloader.py, tests/*.mjs, tests/*.py   ← classic Angl, untouched
app/                     Next.js App Router routes
  (site)/                home, about, writing, library      — public
  clips/[shareId]/[[...slug]]/page.tsx                       — public share pages
  drills/[shareId]/…  plans/[shareId]/…
  studio/                clip editor, drills, plans          — local-first app
  api/v1/…               JSON API (also what MCP wraps later)
lib/
  model/                 types, zod schemas, db ↔ JSON mapping
  legacy/                read filmroom_* keys, ported migrateToGames/migrateToTeams, v1–v4 → v5 converter
  dictation/             parser, duration model, dictation log — pure TS ports
  store/                 IndexedDB local store, sync outbox
  supabase/              server and browser clients
  youtube/               id parsing, facade player, oEmbed lookup
components/
supabase/migrations/
```

`index.html` stays at the repo root and keeps working through `./serve.sh` exactly as it does
today. Next.js ignores it. The classic Node and Python suites keep running in CI unchanged.
That covers "don't break existing users" for anyone who never moves. Once the new studio
reaches feature parity (end of Phase 8), the README points to it and `index.html` gets a small
banner saying the new version exists. It is never deleted in this plan.

### Reading `filmroom_` keys on first load

`lib/legacy/readLegacy.ts` runs in the browser once the studio loads:

1. **Read only.** It reads the `filmroom_*` keys listed in §1. It **never calls `setItem` or
   `removeItem` on any `filmroom_` key**, and it doesn't create `_corrupt` twins either. A
   unit test seeds fake storage, runs the import, and asserts every legacy key is
   byte-identical afterwards.
2. **Same rules as today.** Each key is parsed on its own, as `readStoredList` does, so one
   corrupt key costs only its own data. Then the ported `migrateToGames` and `migrateToTeams`
   run in memory. They are ported to TS with their existing tests ported alongside, so a
   pre-games or pre-teams library converts exactly as classic Angl would convert it.
3. **Conversion to v5:**
   - The legacy team, game and playlist become a `Team`, a `Film` and `Film.categories`.
   - Each clip becomes a `Clip`:
     - `startSeconds/endSeconds` come from `effStart/effEnd`, which is what the coach
       actually watched.
     - `markedStart/End` come from `start/end`.
     - `title` comes from `label`. Notes, tags and credit start empty.
     - The playlist name becomes `category`.
     - `visibility` is `private` and `createdVia` is `import`.
     - `legacy` keeps `{id, gameId, playlistId, index}`.
   - `createdAt` is the parent game's `createdAt` (ms → ISO) plus the clip's array index in
     ms. This keeps the original order, because legacy clips have no timestamps of their own.
   - `durationModel`, `dictationLog`, `settings` and `hotkey` are copied across as they are.
4. **Idempotent ids.** New ids are UUID v5 hashes of `legacyId + videoId + effStart + effEnd`,
   built with Web Crypto. Running the import twice, or importing the same library from a
   second machine, produces the same ids, so merging is safe.
5. **Fingerprint.** A hash of the raw legacy values is stored in the new store. On later
   loads, if the fingerprint has changed because the coach kept using classic Angl, the studio
   offers to "bring in N new clips from classic Angl". Nothing happens silently.
6. **Classic and new run side by side.** The new app never writes legacy keys, so classic Angl
   keeps working at its own state and the two never fight over data.

### The new local store goes in IndexedDB, not localStorage

Putting a second copy of the library into `localStorage` on the same origin could use up the
shared 5 MB quota. **Classic Angl's own saves would then start failing.** So the new app
stores its data in IndexedDB. That uses a different and much larger quota, and only needs a
small hand-written wrapper of about 60 lines, with no dependency. The only `localStorage` key
the new app adds is `filmroom_v2_meta` (fingerprint and migrated-at). It is prefixed
`filmroom_` to follow CONTRIBUTING.md's rule for new keys.

### ⚑ The origin problem (the critical constraint)

`localStorage` is readable only from the origin that wrote it, which is
`http://localhost:8777`. So:

- **Self-hosters** who run the new app locally get the automatic read: `npm run local`
  serves on port 8777. This includes you on your laptop.
- **The hosted site** (your domain) **cannot** read those keys. Existing users there migrate
  by exporting from classic Angl and choosing "Import Angl export". The importer uses the
  same converter, which accepts export versions 1 to 5.

No browser mechanism lets a page on another origin read this data without the old page's
help. I'd rather say this plainly than promise an automatic migration on the hosted site.

### Ported logic and tests

The parser, duration model, dictation log, migrations and sport profiles become pure TS
modules in `lib/`. Every existing Node test gets a TS twin that runs against the new module,
and both copies must pass. The classic tests stay and keep guarding `index.html`. New tests
use `node --test` with Node's built-in TypeScript type stripping (Node 24 LTS), so there is no
test-runner dependency (⚑ D10).

---

## 4. Backend: Supabase

- **Auth:** email magic link, using Supabase Auth with the `@supabase/ssr` cookie session so
  that server components know who is signed in.
  - **Phase 1–7 is single-publisher:** sign-ups are disabled in the Supabase dashboard and
    your account is created by hand.
  - As a second guard, write policies also check
    `exists (select 1 from publishers where user_id = auth.uid())`. A one-row table makes
    "only I can publish" explicit, and removing the check later opens it to everyone.
- **Postgres:** the schema in §2.
- **Row-level security** is enabled on every table:

  ```sql
  -- owner: full access to own rows
  create policy owner_all on public.clips for all to authenticated
    using (owner_id = (select auth.uid()))
    with check (owner_id = (select auth.uid()));
  -- anyone: read PUBLIC rows (powers the public library listing)
  create policy public_read on public.clips for select to anon, authenticated
    using (visibility = 'public');
  ```

  The same pair of policies applies to `drills`, `session_plans`, `films` and `teams`. Films
  and teams have no public read: only owners can see them, and public clip pages don't need
  them.
- **Unlisted items** can't be expressed in RLS ("readable by id, but not listable"). They are
  served by `security definer` functions:
  - `get_shared_clip(share_id)`, `get_shared_drill(share_id)` and
    `get_shared_plan(share_id)` return a curated JSON payload when visibility is `public` or
    `unlisted`, and nothing otherwise.
  - The payload excludes `owner_id` and `legacy`.
  - `get_shared_plan` also includes the referenced drills and clips that are themselves
    non-private. A private item inside a shared plan renders as "private item". It is never
    leaked.
  - The publish UI warns about such items and offers "also share N referenced items as
    unlisted".
- **Storage:** one public bucket, `site-assets`, for profile photos, the about-page image and
  brand images. **No video, ever.** RLS on `storage.objects` lets only the owner write.
- **Page rendering never uses the service-role key.** Share pages call the RPCs with the anon
  key. The service role is only used by the revalidation webhook, if at all.
- **Local-first when signed out:** the studio works fully against IndexedDB without an
  account. Rows have `ownerId: null`. Signing in attaches them to your account on first sync.
- **Sync** (Phase 7):
  - An outbox of changed documents is pushed by upsert. Changes since the last `updated_at`
    are pulled.
  - Conflicts resolve as **last write wins per document**. That is the right trade-off for one
    person on two or three devices. It is not suitable for collaborative editing, which isn't
    in scope.
  - LLM settings and API keys are **never synced**. They stay local and are excluded at the
    type level.

---

## 5. Features in build order

### 5.0 Public clip share pages (ships first)

These are your top priority, so they come before everything else.

- **Route:** `/clips/{shareId}/{optional-title-slug}`. Only the `shareId` is used for lookup;
  the slug is there so links read well, and a wrong slug redirects to the correct one.
- **Rendering:** a server component with ISR. The page is cached at the CDN and revalidated
  by `revalidatePath` when you publish or edit, so it loads from the edge.
- **Player:**
  - The page HTML has no YouTube JS. A "lite embed" facade shows the thumbnail with a play
    button, as a hand-written component of about 60 lines.
  - On tap it injects the `youtube-nocookie` iframe with `playsinline=1`,
    `start=floor(startSeconds)`, `end=ceil(endSeconds)` and `autoplay=1`. YouTube enforces
    start and end itself, so there is no polling on the public page.
  - It offers "Replay clip", which seeks back to the start, and "Watch full video on YouTube",
    which links to `youtube.com/watch?v=…&t=…s`.
  - If the video can't be embedded or has been removed (player error 101, 150 or 100), the
    thumbnail and the YouTube link remain.
- **Content:** title, your notes, coaching points, tag chips that link to `/library?tag=…`,
  and a credit line: *"Footage: {coachName} — {sourceTitle}"* linking to the source video
  and to their channel.
- **Open Graph and Twitter tags** come from `generateMetadata`:
  - `og:title`, `og:description` (the first ~150 characters of notes), `og:url` and
    `og:type=video.other`.
  - `og:image` is the stored `thumbnailUrl` with its width and height, and
    `twitter:card=summary_large_image`.
  - At publish time the server checks whether `maxresdefault.jpg` exists and otherwise falls
    back to `hqdefault.jpg`, then stores the result. Scrapers therefore never get a missing
    image.
- **Every public page has:**
  - a `<SubscribeCta>` component with a button to `https://hamishdawson33.substack.com/subscribe` (from `NEXT_PUBLIC_SUBSTACK_URL`, D2), placed
    after the content and in the footer;
  - the Umami analytics script (D3).
  - Analytics events: page view, `clip_play`, `subscribe_click` and `source_click`.
- **Performance budget:** Lighthouse mobile performance ≥ 90 and LCP < 2.5 s on simulated
  4G. The LCP element is the thumbnail, which is preloaded. The page must not fetch any
  YouTube JS until the visitor taps.

### 5.1 Clip editor (port the existing one)

- Feature parity with `index.html`:
  - teams with sport, films (games), categories (playlists), the cross-game category view;
  - buffers, loop, play-all and free scrub;
  - the dashboard;
  - dictation with confirm cards, the duration model and the dictation log;
  - BYO-key AI parsing;
  - export (v5) and import (v1–v5);
  - keyboard shortcuts.
- **New fields:** notes, tags, coaching points and credit, with credit auto-filled from
  YouTube oEmbed (title and channel, no API key).
- **New action:** a visibility switch with copy-link.
- **Mobile layout:**
  - A single column: player at the top, then tabs for *Add clip*, *Clips* and *Categories*.
  - "↓ current" buttons and touch targets are at least 44 px.
  - Dictation uses a large hold-to-talk button instead of the hotkey (⚑ D9).
- **Clip-end enforcement:** keep the existing polling watcher in the editor, because it
  needs loop and play-all.

### 5.2 Drill library

- A list with tag filter and search (title, summary and tags, done client-side over the local
  store).
- Drill editor: summary, description, duration, players, equipment, coaching points,
  progressions, tags, linked clips (a picker from the clip library) and diagrams (from 5.4).
- Tap-friendly on a phone. There is a "duplicate drill" action.

### 5.3 Session plan builder

- Add blocks of the five types. A drill or clip block is added from a searchable picker. A
  drill block's duration defaults to the drill's. A clip block's duration defaults to the
  clip's length rounded up to a whole minute, at least 1.
- **Reorder:**
  - Drag and drop with `@dnd-kit`, using pointer, touch and keyboard sensors.
  - Every block also has ↑/↓ buttons, because dragging on a phone in a gym is fiddly.
- **Inline clip playback:** a clip block expands to the same facade player, with start and
  end enforced.
- **Time:**
  - Shows the running time at each block ("0:00–0:10") and a total in the header.
  - Shows a planned versus target length (for example, a 90-minute session) with an over/under
    indicator.
- Duplicate plan, and "save as template". A template is just a plan with the `template` tag.
  There is no new type.

### 5.4 SVG half-court diagram editor

- Hand-written SVG with no library. The court is drawn in metres (FIBA, ⚑ D6) using a
  `viewBox` of `0 0 15 14`, so coordinates in the JSON are the same as the drawing.
- **Tools:**
  - players (offense and defense, numbered), coach, cone and ball;
  - paths: cut (solid arrow), pass (dashed), dribble (zig-zag), screen (T-bar) and handoff;
  - text.
- Tap to place and drag to move, with pointer events that work for both touch and mouse.
  Paths are drawn by tapping points and double-tapping to finish. Each path has a numbered
  sequence step.
- Undo/redo, which is just a history stack because the state is plain JSON.
- Export an SVG or PNG of a single diagram for Substack posts. PNG uses a canvas, with no
  dependency.
- Used inside drills (`diagrams[]`) and as `diagram` blocks in plans.

### 5.5 Print / PDF export

- `@media print` stylesheet for plans and drills. "Print / Save as PDF" calls
  `window.print()`. Browsers on iOS, Android and desktop can all save the result as PDF, so
  no PDF library is needed.
- **Plan printout:**
  - A header with date, team, objectives and total time.
  - A time-banded table of blocks, with the diagrams rendered inline as vector SVG.
  - A clip block prints its thumbnail, its share URL in text and its coaching points.
- **QR codes** for the clips are optional and would need one small dependency (⚑ D11). The
  default is a printed short URL.
- The print view works offline once the plan is loaded, which suits a laminated sheet at
  training.

### 5.6 Public share pages for drills and plans

These reuse the 5.0 shell: OG tags, subscribe CTA and analytics.

- A drill page shows the description, coaching points, diagrams (SVG) and example clips.
- A plan page shows its blocks in order with times, expandable drills, inline clip players
  and diagrams.
- `og:image` for drills and plans is generated with Next's built-in `next/og`
  (`ImageResponse`, which is no extra dependency). It shows the title, total time and first
  diagram on a branded card.

---

## 6. Personal site pages

All of these are server-rendered, cached, include the subscribe CTA and analytics, and are
mobile-first.

| Route | Content |
|---|---|
| `/` | Hero (who you are, one line), the latest 3 Substack posts, featured public plans, drills and clips (newest or a `featured` tag), and a subscribe block. |
| `/about` | Bio, photo and links. Rendered from your `profiles` row, so no personal copy is hard-coded in the MIT repo. |
| `/writing` | The Substack feed, fetched server-side from `{substack_url}/feed` (RSS) and revalidated hourly. Shows title, date, excerpt, image and a link out. We don't copy full posts. |
| `/library` | Public clips, drills and plans, with tabs, a tag filter (`?tag=`) and pagination. This is where tag chips from share pages lead. |

The site's identity (name, Substack URL, accent colour) comes from your profile row plus a
small `site.config.ts` with env overrides. That keeps the codebase generic (§8).

---

## 7. AI-ready design: none of this gets built now

The point of this section is that no later AI feature should force a schema or API
restructure.

- **One service layer.** All reads and writes go through `lib/library/*`: `listDrills`,
  `getPlan`, `upsertDrill`, `createPlan`, `searchLibrary` and so on. Each function takes a
  zod-validated input and an auth context.
  - The UI (server actions), the REST API (`/api/v1/*`) and a future MCP server are all thin
    adapters over it.
  - An MCP tool would be roughly `server.tool('list_drills', zodToJsonSchema(ListDrillsInput),
    (args) => listDrills(ctx, args))`.
- **Plan generation from my drill library:**
  - The input is constraints (length, focus tags, number of players, team) plus the library,
    retrieved via `searchLibrary`.
  - The output is a `SessionPlan` JSON whose blocks reference existing `drillId`s. It is
    validated by the same zod schema and saved with `createdVia: 'ai'`, `visibility:
    'private'`.
  - Nothing new is needed in the schema.
- **Tag and coaching-point suggestions:** suggestions are proposals, not edits. Later we add
  a `suggestions` table (`entity_type`, `entity_id`, `patch jsonb`, `status`, `model`,
  `created_at`). That is a new table and needs no change to existing ones. `tags` and
  `coachingPoints` are already plain string arrays that a model can produce directly.
- **Semantic search:** later we add a `pgvector` `embedding` column to clips and drills. That
  is a non-breaking column add, populated by a background job.
- **MCP server:**
  - It exposes `search_library`, `get_drill`, `get_plan`, `list_tags`, `create_plan_draft`
    and `suggest_tags` over the service layer.
  - It authenticates with personal access tokens, using a later `api_tokens` table that
    stores hashed tokens with scopes.
  - It is read-only plus "create private draft" by default. It never changes visibility.
- **The existing dictation log and BYO-key parser** carry over unchanged. The log is
  training data for a future parser and stays local unless you choose otherwise.
- **Provenance:** `createdVia` on every item means AI-made content can always be found,
  filtered and kept private by default.
- **Schemas published as JSON Schema** at `/api/v1/schema`, generated from zod, so external
  LLM tooling can read and write the format.

---

## 8. Open-source boundary

**All code in this repo stays MIT.** That covers:

- the classic app;
- the Next.js studio and the share pages;
- the schema, migrations and RLS;
- the diagram editor;
- the later API and MCP server.

**Not in the repo, and therefore not licensed:**

- **Your content:** clips, notes, drills, plans and the about text. These live in your
  Supabase database and storage.
- **Your brand:** the "Beyond The Arc" name, logo and photos. They go in the
  `site-assets` bucket. A short `TRADEMARKS.md` says forks must not use your name or logo.
- **Secrets and config:** `.env.local` with the Supabase URL and keys, the analytics site
  id and the Substack URL. A `.env.example` documents them.

**How a hosted multi-tenant version could run from the same codebase later:**

- `ANGL_MODE=single` (now): the site's home, about and library pages show
  `SITE_OWNER_HANDLE`'s content, and sign-ups are closed.
- `ANGL_MODE=multi` (later):
  - Sign-ups are open, every user gets a profile and handle, and public pages also exist at
    `/u/{handle}/…`.
  - RLS is already per-owner, so the data layer needs no change.
  - Remove the `publishers` guard, or turn it into a plan or quota check.
  - Add per-tenant limits, such as rows per table and AI calls metered or BYO-key.
- **Billing**, if it ever happens, could be a separate module. Keeping it MIT too is the
  simplest and most honest choice: what the hosted version sells is the hosting.
  - ⚑ If you'd rather stop a third party running a competing hosted copy, the usual tool is
    AGPL for new code. That would be a licence change you should decide on deliberately and
    early, because relicensing after outside contributions is hard.
- **CONTRIBUTING.md needs rewriting.** Its "keep the toolchain empty" rule applies to
  `index.html` only. The new app has a toolchain, so its dependency rule becomes "every
  dependency is listed and justified in PLAN.md / CONTRIBUTING.md".

---

## 9. Dependencies

Every runtime dependency, with its justification:

| Package | Why it can't be done by hand |
|---|---|
| `next`, `react`, `react-dom` | The chosen framework (App Router, ISR, metadata API, `next/og` for OG images). |
| `@supabase/supabase-js` | Auth, Postgres access and Storage. Its auth refresh logic shouldn't be reimplemented. |
| `@supabase/ssr` | Cookie-based sessions in server components and route handlers. Without it, server rendering can't know who is signed in. |
| `zod` | Runtime validation at every trust boundary (import files, API, sync, later AI output) and JSON Schema generation for LLM tools. |
| `@dnd-kit/core`, `@dnd-kit/sortable` | Added in the plan-builder phase. HTML5 drag-and-drop doesn't work on touch devices, and accessible keyboard drag is substantial work. ↑/↓ buttons exist as the fallback. |
| `fast-xml-parser` | Added in the site-pages phase to parse the Substack RSS. Parsing XML with regexes breaks on CDATA and entities. It has no dependencies. ⚑ It could be avoided if Substack's JSON endpoints prove stable, but those are undocumented. |

Dev dependencies are `typescript` and `@types/*`. Tests run on `node --test` with no runner
dependency. Playwright is used only for local and CI smoke checks of the share page, as an
optional dev dependency.

**Deliberately not used:**

- Tailwind or a UI kit: we use CSS Modules and port the existing CSS variables.
- A state-management library.
- An ORM: the Supabase client and SQL are enough.
- A PDF library: we use print CSS.
- A diagram or canvas library: we use hand-written SVG.
- `lite-youtube-embed`: we write about 60 lines of our own.
- An analytics npm package: it's one script tag.

---

## 10. Phases

Each phase is meant to fit in one session, end in a deploy or merge, and leave everything
earlier still working. **For every phase:** classic `index.html` is untouched, both classic
test suites pass, the new tests pass, and the app runs on a 390 px-wide phone viewport without
horizontal scroll.

### Phase 1 — Scaffold + public clip page

**Status (2026-11-06): built, not yet deployed.**

Done and verified in this container:
- Migrations `20261106000000_init` and `…000100_restrict_is_publisher` are applied to the Supabase project (`ckijrhfynlofoeylnsfj`).
- The access rules pass both in SQL (owner, non-publisher, signed out) and over the REST API (`npm run check:rls`, 13 checks).
- A clip page at a 390 px phone width makes no request to `youtube.com` before the tap, and the embed starts at the clip's start time.
- Wrong or missing slugs redirect (308) to the canonical URL. Private and unknown ids 404. Unlisted pages carry `noindex`.
- Pages are cached (`s-maxage=300` plus stale-while-revalidate).

Decisions made while building:
- The share page reads through a plain cached `GET` to the RPC. `@supabase/supabase-js` and `@supabase/ssr` move to Phase 2, where sign-in needs them, so Phase 1 has no Supabase dependency.
- `zod` also waits for Phase 2. The single RPC payload is checked by a small hand-written parser (`lib/shared-clip.ts`, tested).
- The poster uses `next/image`, Next's built-in resizer, so phones get a resized AVIF or WebP from the same origin. The `og:image` link preview stays the raw YouTube thumbnail. ⚑ Vercel's Hobby tier limits image transformations each month. With one resize per clip and screen size, cached for a month, this should stay far under the limit, but check the usage page.
- The stylesheet is inlined (`experimental.inlineCss`), so there is no render-blocking CSS.
- Tag chips aren't links yet, because `/library` arrives in Phase 3.
- The site name comes from `NEXT_PUBLIC_SITE_NAME`, set to "Beyond The Arc" on Vercel.

Still to do before Phase 1 is complete:
- Seed your real first clip: you choose the video, then run the SQL.
- Deploy to Vercel and set the env vars.
- Check playback on a real iOS and Android phone.
- Paste the link into Substack, iMessage and WhatsApp to check the previews.
- Run Lighthouse against the deployed URL. The local run can't count, because `i.ytimg.com` doesn't resolve for Next's image resizer in this container.
- Add the Umami website id.

- Next.js + TypeScript at the repo root, alongside the classic files.
- Supabase project with migration `0001`: `profiles`, `publishers`, `clips`, enums, triggers,
  RLS and `get_shared_clip`.
- `/clips/[shareId]` with the facade player, notes, tags, credit, OG tags, `<SubscribeCta>`
  and the analytics tag.
- One clip seeded by SQL. Deployed.
- CONTRIBUTING and README updated to describe the two apps.

Acceptance criteria:
- [ ] The seeded clip's URL, pasted into Substack's editor, iMessage and WhatsApp, shows the
  YouTube thumbnail, title and description.
- [ ] Tapping play on iOS Safari and Android Chrome plays from `startSeconds` and stops at
  `endSeconds`. "Replay" restarts the clip.
- [ ] A private clip's URL returns 404. An unlisted clip renders by URL, is absent from the
  anon `select` on `clips`, and has `noindex`.
- [ ] Lighthouse mobile performance ≥ 90. No request to `youtube.com` is made before the tap.
- [ ] Anonymous `insert`, `update` and `delete` on `clips` are rejected (tested with the anon
  key).
- [ ] The subscribe button links to the Substack subscribe page. A page view and a
  `subscribe_click` show up in analytics.

### Phase 2 — Publishing (only me)

- Magic-link sign-in with sign-ups disabled.
- `/studio/publish`: import an Angl export (v1–v4). This uses `lib/legacy` (the ported
  migrations and converter) and the ported migration tests.
- Pick clips, then edit title, notes, coaching points, tags and credit. Credit is auto-filled
  from oEmbed.
- Set visibility, publish, edit and unpublish. Publishing revalidates the page and stores
  `thumbnailUrl`.

Acceptance criteria:
- [ ] Importing a real `angl-clips.json` lists every clip grouped by team, film and category,
  matching classic Angl's counts.
- [ ] The ported TS migration tests pass and produce the same results as the classic ones on
  the same fixtures.
- [ ] Publishing a clip makes its page live within 60 s with your notes. Editing its notes
  updates the live page. Unpublishing returns a 404.
- [ ] Re-importing the same file creates no duplicates (UUID v5 ids).
- [ ] A second, non-publisher account (created by hand for the test) cannot insert rows.

### Phase 3 — Site pages

- Home, about (from the profile), writing (Substack RSS) and `/library` (public clips, tag
  filter).
- Shared layout with header, footer and the subscribe CTA.

Acceptance criteria:
- [ ] `/writing` shows the latest posts and still renders a stale-but-valid page if Substack
  is unreachable.
- [ ] Tag chips on a clip page lead to a filtered `/library`.
- [ ] Every public route has the CTA, analytics and valid OG tags, checked by a script that
  crawls the sitemap.
- [ ] `sitemap.xml` and `robots.txt` list public items only.

### Phase 4 — Local store + first-load legacy migration

- IndexedDB store.
- `readLegacy`, so that on the `localhost:8777` origin the studio imports `filmroom_*` keys
  automatically.
- Fingerprint and "bring in new clips" prompt.
- v5 export/import.

Acceptance criteria:
- [ ] With legacy keys seeded (pre-games, pre-teams and current shapes), the studio shows the
  full library on first load.
- [ ] **Every `filmroom_*` key is byte-identical before and after**, and no key is removed
  (automated test).
- [ ] A second load imports nothing. Adding a clip in classic Angl and then reloading the
  studio offers exactly one new clip.
- [ ] A corrupt `filmroom_clips` costs only clips. Teams, films and categories still import.
- [ ] Export v5 followed by import v5 round-trips with deep equality.

### Phase 5 — Clip editor port, part A (player and library)

- Player, films, categories, add/edit/delete clips, buffers, loop, play-all, free scrub, the
  dashboard and the new fields (notes, tags, credit, visibility).
- Mobile tabbed layout.

Acceptance criteria:
- [ ] Every non-dictation action in classic Angl has an equivalent, checked against a written
  parity checklist.
- [ ] On a phone you can paste a URL, mark start and end with "↓ current", label the clip and
  save it in under 30 s.
- [ ] Play-all crosses films correctly.

### Phase 6 — Clip editor port, part B (dictation)

- Pure TS parser, duration model, dictation log and sport profiles. All 102 classic test cases
  are ported and passing against the TS modules.
- Dictation UI with hotkey on desktop and hold-to-talk button on mobile.
- Confirm cards.
- BYO-key AI parsing, with the key stored locally only.

Acceptance criteria:
- [ ] The TS test suite matches the classic suite case for case. There is a CI job for both.
- [ ] Dictating "fifteen thirty four long pick and roll" produces the same pending clip in the
  studio and in classic Angl.
- [ ] The API key never appears in any network request except to the configured LLM endpoint,
  and never in the sync payload. The latter is checked by a type-level exclusion and a test.

### Phase 7 — Sign-in sync

- Outbox and last-write-wins sync for teams, films and clips.
- Publish straight from the editor. `/studio/publish` becomes a view over the same data.

Acceptance criteria:
- [ ] A clip made offline on a phone appears on the laptop after both are online.
- [ ] Concurrent edits resolve to the later `updatedAt` without corrupting either document.
- [ ] Signing out keeps the local library usable. Signing in attaches local
  `ownerId: null` rows to the account once.

### Phase 8 — Drill library

- Drills table and migration with RLS, CRUD both local and synced, the tag filter and the clip
  picker.

Acceptance criteria:
- [ ] Create, edit, duplicate and delete work offline and sync.
- [ ] Linked clips play inline.
- [ ] Filtering by two tags shows only drills that have both.

### Phase 9 — Session plan builder

- Plans table and migration.
- The five block types, the pickers, ↑/↓ reorder and drag and drop (`@dnd-kit`).
- Inline clip playback, the running and total time, and the target length.

Acceptance criteria:
- [ ] Building a 90-minute plan from 6 drills, 2 clips and a water break shows a correct total
  and per-block times.
- [ ] Reordering by drag works with touch on a phone and with the keyboard. The ↑/↓ buttons
  give the same result.
- [ ] Deleting a drill that a plan uses leaves an "item removed" block and no crash.

### Phase 10 — Diagram editor

- SVG half court, tools, sequence steps, undo/redo, SVG and PNG export, embedding in drills
  and diagram blocks.

Acceptance criteria:
- [ ] A 5-on-0 set with two passes, a cut and a screen can be drawn on a phone.
- [ ] Saved JSON coordinates are in metres and render identically after reload.
- [ ] A diagram written by hand as JSON (as an LLM would write it) renders correctly.

### Phase 11 — Print/PDF

- Print stylesheet for plans and drills.

Acceptance criteria:
- [ ] A plan prints on A4 and Letter with no clipped blocks.
- [ ] Diagrams are sharp vectors.
- [ ] Clip blocks show their thumbnail and URL.
- [ ] "Save as PDF" works on iOS Safari.

### Phase 12 — Drill and plan share pages

- `get_shared_drill` and `get_shared_plan`, the pages, `next/og` cards, and drills and plans
  added to `/library`.

Acceptance criteria:
- [ ] All Phase 1 acceptance criteria, applied to drills and plans.
- [ ] A shared plan never reveals a private referenced item (test: a private drill inside a
  public plan renders as "private item" for anon).
- [ ] The publish dialog offers to share the referenced items.

Later, unplanned: AI features (§7), `ANGL_MODE=multi`, a PWA/offline shell.

---

## 11. Decisions I need from you (⚑)

| # | Question | My default if you don't decide |
|---|---|---|
| D1 | ✅ **Decided:** leave `clip_downloader.py` in the repo untouched. It is not part of the website: it isn't ported and isn't linked from any page. | — |
| D2 | ✅ **Decided:** Substack is `https://hamishdawson33.substack.com`. The CTA links to `/subscribe` and the feed is `/feed`. It is set through the `NEXT_PUBLIC_SUBSTACK_URL` env var, with this as the default. | — |
| D3 | ✅ **Decided:** Umami, on the Cloud free tier (or self-hosted if that tier stops being enough). One env-configured script tag: `NEXT_PUBLIC_UMAMI_WEBSITE_ID` plus the script URL. It's cookieless, so no consent banner (not legal advice). ⚑ Check the free tier's monthly event limit when you sign up. | — |
| D4 | ✅ **Decided:** Vercel. ⚑ The Hobby (free) tier is for non-commercial use. A personal site that promotes a free Substack is probably fine, but if the Substack becomes paid, or you sell coaching, check the terms or move to Pro. | — |
| D5 | Is anyone besides you using classic Angl? This sets how much effort goes into the import UX for the hosted origin. | Assume a few self-hosters. The export → import path is enough. |
| D6 | Court coordinates: FIBA metres or NBA/NCAA feet? | FIBA metres on a 15 × 14 m half court. A later `court` field can add others. |
| D7 | Should notes be plain text or Markdown? Markdown means a renderer, which is either a dependency or a careful hand-written subset. | Plain text with line breaks and auto-linked URLs. |
| D8 | Should `og:image` for clips be the raw YouTube thumbnail, as you asked, or a branded card from `next/og` built around the thumbnail? | The raw thumbnail in Phase 1. Revisit in Phase 12. |
| D9 | Web Speech API support on iOS Safari and in-app browsers is patchy. Mobile dictation may not work everywhere. | Hide the mic where it isn't supported. Typing always works. |
| D10 | Node's built-in TypeScript stripping for tests means no enums, no parameter properties, and explicit `.ts` import extensions. | Accept those limits. If they get in the way, fall back to Vitest as one dev dependency. |
| D11 | Should printed plans have QR codes for clips? That needs a small dependency. | No. Print the short URL. |
| D12 | iOS can require a second tap to start playback after the facade swaps in the iframe. The iframe is requested with `autoplay=1` and `allow="autoplay"`. Headless Chromium starts the embed correctly, but **real iOS and Android are untested** until the site is deployed. | If iOS needs a second tap, accept it. |
| D13 | ✅ **Decided:** pinned at Phase 1 to Next.js 16.4.5 and React 19.3.1, with TypeScript **6.0.3**, not 7. Next 16.4's built-in type check needs the TypeScript JavaScript API, which TypeScript 7 (the native compiler) doesn't ship. Revisit when Next supports 7. | — |
| D14 | Licence: MIT for everything, or AGPL for the new app to stop competing hosted copies? | MIT, as you said. |
