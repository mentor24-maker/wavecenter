-- The Forum's topics and tags (Dane, 2026-11-15, WC-178: "Add a Topics
-- section on the Forum page. Add a colex Add Topic field over a table of
-- topics. The top section will also have an area for tags. Let's put Topics
-- left, Tags right. Align both in columns and rol[ws]"; and on the ticket,
-- that tags are the same shape as topics: an Add Tag box over a table).
--
-- Two new tables, each with row-level security on from the moment it is
-- made (engineering rule 2):
--
--   forum_topics  one topic members can discuss on the Forum
--   forum_tags    one tag members can use to sort the Forum's discussions
--
-- Tags are only listed for now; attaching a tag to a topic, threads, and
-- changing or deleting either one are later tickets. Adding one is not
-- scored yet.
--
-- Every signed-in member reads every topic and tag and may add one, in their
-- own name. Nobody changes or deletes one yet (no grant for it). Names are
-- unique without regard to capitals or the spaces around them, so the list
-- never holds "Voting" twice. The rules live in core/forum.ts; the
-- database repeats them so a client that went around core still cannot
-- break them.
--
-- Additive and safe to re-run: every create checks first.

create table if not exists public.forum_topics (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null check (length(btrim(name, E' \t\n\r\f\x0B')) between 1 and 80),
  -- Who added it; set by the database to whoever is signed in. Deleting
  -- their account keeps the topic for everyone else.
  created_by uuid        default auth.uid() references auth.users (id) on delete set null,
  tool       text        not null default 'wavecenter' check (length(btrim(tool)) > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.forum_tags (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null check (length(btrim(name, E' \t\n\r\f\x0B')) between 1 and 80),
  created_by uuid        default auth.uid() references auth.users (id) on delete set null,
  tool       text        not null default 'wavecenter' check (length(btrim(tool)) > 0),
  created_at timestamptz not null default now()
);

-- Row-level security in the same step that makes the tables (engineering rule 2).
alter table public.forum_topics enable row level security;
alter table public.forum_tags enable row level security;

create unique index if not exists forum_topics_name_key on public.forum_topics (lower(btrim(name, E' \t\n\r\f\x0B')));
create unique index if not exists forum_tags_name_key   on public.forum_tags   (lower(btrim(name, E' \t\n\r\f\x0B')));

-- Start from no rights at all (Supabase's defaults include update, delete
-- and truncate) and grant only reading and adding.
revoke all on public.forum_topics, public.forum_tags from anon, authenticated;
grant select, insert on public.forum_topics, public.forum_tags to authenticated;

drop policy if exists "forum_topics: every member can read" on public.forum_topics;
drop policy if exists "forum_topics: a member adds in their own name" on public.forum_topics;
drop policy if exists "forum_tags: every member can read" on public.forum_tags;
drop policy if exists "forum_tags: a member adds in their own name" on public.forum_tags;

create policy "forum_topics: every member can read" on public.forum_topics
  for select to authenticated using (true);

create policy "forum_topics: a member adds in their own name" on public.forum_topics
  for insert to authenticated
  with check ((select auth.uid()) = created_by);

create policy "forum_tags: every member can read" on public.forum_tags
  for select to authenticated using (true);

create policy "forum_tags: a member adds in their own name" on public.forum_tags
  for insert to authenticated
  with check ((select auth.uid()) = created_by);

-- created_at is the database's own, never the caller's.
create or replace function public.forum_entry_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists forum_topics_stamp on public.forum_topics;
create trigger forum_topics_stamp
  before insert on public.forum_topics
  for each row execute function public.forum_entry_stamp();

drop trigger if exists forum_tags_stamp on public.forum_tags;
create trigger forum_tags_stamp
  before insert on public.forum_tags
  for each row execute function public.forum_entry_stamp();

notify pgrst, 'reload schema';
