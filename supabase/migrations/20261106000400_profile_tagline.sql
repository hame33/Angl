-- A one-line description for the home page and link previews ("Basketball
-- coach in Melbourne. Writing Beyond The Arc."). The bio stays the long form
-- for the about page.
alter table public.profiles
  add column tagline text not null default '' check (char_length(tagline) <= 200);
