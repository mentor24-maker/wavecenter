-- Tags on a Forum topic (WC-249, Dane, 2026-11-26: "Let members attach tags
-- to a forum topic ... A topic's adder or an admin attaches and removes them
-- from the topic's edit page").
--
-- One new table, row-level security on in the same migration that makes it
-- (engineering rule 2):
--
--   forum_topic_tags  one row per topic-and-tag pair: this topic carries this
--                     tag. A pair is stored once (the primary key). Deleting
--                     the topic or the tag deletes its pairs.
--
-- Every signed-in member reads every pair. Only the topic's adder or an admin
-- attaches or removes a tag: tagging a topic is changing that topic, the same
-- rule as core's mayChangeTopic. Who attached it is the database's to set
-- (whoever is signed in), and so is when. A pair is never changed, only
-- attached or removed.
--
-- The rules live in core/forum.ts (attachTopicTag, detachTopicTag); the
-- database repeats them so a client that went around core still cannot break
-- them. Additive and safe to re-run.

create table if not exists public.forum_topic_tags (
  topic_id   uuid        not null references public.forum_topics (id) on delete cascade,
  tag_id     uuid        not null references public.forum_tags (id) on delete cascade,
  -- Who attached it; set by the database to whoever is signed in.
  created_by uuid        default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (topic_id, tag_id)
);

alter table public.forum_topic_tags enable row level security;

-- The tag page asks "which topics carry this tag?"
create index if not exists forum_topic_tags_tag_idx on public.forum_topic_tags (tag_id);

revoke all on public.forum_topic_tags from anon, authenticated;
grant select, delete on public.forum_topic_tags to authenticated;
grant insert (topic_id, tag_id) on public.forum_topic_tags to authenticated;

drop policy if exists "forum_topic_tags: every member can read" on public.forum_topic_tags;
drop policy if exists "forum_topic_tags: the topic's adder or an admin attaches a tag" on public.forum_topic_tags;
drop policy if exists "forum_topic_tags: the topic's adder or an admin removes a tag" on public.forum_topic_tags;

create policy "forum_topic_tags: every member can read" on public.forum_topic_tags
  for select to authenticated using (true);

create policy "forum_topic_tags: the topic's adder or an admin attaches a tag" on public.forum_topic_tags
  for insert to authenticated
  with check (
    (select auth.uid()) = created_by
    and (
      (select private.member_role(auth.uid())) = 'admin'
      or exists (select 1 from public.forum_topics t
                  where t.id = topic_id and t.created_by = (select auth.uid()))
    )
  );

create policy "forum_topic_tags: the topic's adder or an admin removes a tag" on public.forum_topic_tags
  for delete to authenticated
  using (
    (select private.member_role(auth.uid())) = 'admin'
    or exists (select 1 from public.forum_topics t
                where t.id = topic_id and t.created_by = (select auth.uid()))
  );

-- When a tag was attached is the database's own.
create or replace function public.forum_topic_tag_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists forum_topic_tags_stamp on public.forum_topic_tags;
create trigger forum_topic_tags_stamp
  before insert on public.forum_topic_tags
  for each row execute function public.forum_topic_tag_stamp();

notify pgrst, 'reload schema';
