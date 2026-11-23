-- A Forum topic's details, and changing and deleting a topic (WC-183, Dane,
-- 2026-11-22: "Give Topics a CRUD table and details/editpage. View/Edit/
-- Delete. No clone. On details page provide four fields: Name, slug,
-- description, details, with details as a rich text editor field. ... Add
-- 'Parent' column"). On the ticket he chose who may change or delete a
-- topic, "A": the member who added it, and admins.
--
-- New columns on forum_topics (row-level security is already on, from the
-- migration that made the table):
--
--   slug         the topic's short web-address name: lower-case letters,
--                digits and single hyphens, unique. Made from the name when
--                a topic is added without one; existing topics get theirs here.
--   description  one plain line, at most 500 characters ('' when none)
--   details      rich text in the task comments' format (core/richText.ts),
--                plain words never HTML, at most 10,000 characters
--   parent_id    the topic it sits under, or null. A topic is never its own
--                parent or its own ancestor. Deleting a parent leaves its
--                sub-topics in place with no parent.
--   updated_at   when it was last changed; the database stamps it
--
-- New rights, each with its policy in this same migration (rule 2): the
-- adder or an admin changes name, slug, description, details and parent, and
-- deletes the topic. Nothing else about a topic can be changed. Tags are
-- untouched: still no changing or deleting.
--
-- The rules live in core/forum.ts; the database repeats them so a client that
-- went around core still cannot break them. Additive and safe to re-run.

alter table public.forum_topics add column if not exists slug        text;
alter table public.forum_topics add column if not exists description text not null default '';
alter table public.forum_topics add column if not exists details     text not null default '';
alter table public.forum_topics add column if not exists parent_id   uuid references public.forum_topics (id) on delete set null;
alter table public.forum_topics add column if not exists updated_at  timestamptz;

-- The slug a name suggests, the same one core's topicSlug() makes: lower
-- case, every run of anything but a-z and 0-9 one hyphen, none at the ends,
-- at most 80 characters, "topic" if nothing is left.
create or replace function public.forum_topic_slug_from(name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    nullif(rtrim(left(btrim(regexp_replace(lower(coalesce(name, '')), '[^a-z0-9]+', '-', 'g'), '-'), 80), '-'), ''),
    'topic');
$$;

-- `base`, or base-2, base-3 ... whichever no other topic's slug is.
create or replace function public.forum_topic_unique_slug(base text, self uuid)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  candidate text := base;
  n int := 1;
begin
  while exists (select 1 from public.forum_topics t where t.slug = candidate and t.id is distinct from self) loop
    n := n + 1;
    candidate := rtrim(left(base, 80 - length('-' || n)), '-') || '-' || n;
  end loop;
  return candidate;
end;
$$;

revoke execute on function public.forum_topic_slug_from(text) from public, anon;
revoke execute on function public.forum_topic_unique_slug(text, uuid) from public, anon;
-- The trigger below runs as the signed-in member, so they need to run these.
grant execute on function public.forum_topic_slug_from(text) to authenticated;
grant execute on function public.forum_topic_unique_slug(text, uuid) to authenticated;

-- Existing topics get a slug from their name, oldest first.
do $$
declare
  r record;
begin
  for r in select id, name from public.forum_topics where slug is null order by created_at, id loop
    update public.forum_topics
       set slug = public.forum_topic_unique_slug(public.forum_topic_slug_from(r.name), r.id)
     where id = r.id;
  end loop;
end;
$$;

-- An existing topic was last changed when it was added.
update public.forum_topics set updated_at = created_at where updated_at is null;
alter table public.forum_topics alter column updated_at set default now();
alter table public.forum_topics alter column updated_at set not null;

alter table public.forum_topics alter column slug set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'forum_topics_slug_shape') then
    alter table public.forum_topics add constraint forum_topics_slug_shape
      check (length(slug) between 1 and 80 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'forum_topics_description_shape') then
    alter table public.forum_topics add constraint forum_topics_description_shape
      check (length(description) <= 500 and description !~ '[\r\n]');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'forum_topics_details_length') then
    alter table public.forum_topics add constraint forum_topics_details_length
      check (length(details) <= 10000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'forum_topics_not_own_parent') then
    alter table public.forum_topics add constraint forum_topics_not_own_parent
      check (parent_id is distinct from id);
  end if;
end;
$$;

create unique index if not exists forum_topics_slug_key on public.forum_topics (slug);
create index if not exists forum_topics_parent_idx on public.forum_topics (parent_id);

-- Before a topic is added or changed: give it a slug if it has none, refuse a
-- parent that would make a loop, and stamp the times. Parent changes take one
-- lock so two at once cannot together make a loop neither would alone.
-- It never touches parent_id itself, so "on delete set null" still clears a
-- deleted parent from its sub-topics.
create or replace function public.forum_topic_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.slug is null or btrim(new.slug) = '' then
    new.slug := public.forum_topic_unique_slug(public.forum_topic_slug_from(new.name), new.id);
  end if;

  if new.parent_id is not null and (tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id) then
    perform pg_advisory_xact_lock(hashtext('public.forum_topics.parent_id'));
    if new.parent_id = new.id or exists (
      with recursive up(id) as (
        select t.parent_id from public.forum_topics t where t.id = new.parent_id
        union
        select t.parent_id from public.forum_topics t join up on t.id = up.id
      )
      select 1 from up where up.id = new.id
    ) then
      raise exception 'A topic cannot sit under itself or under one of its own sub-topics.'
        using errcode = 'check_violation';
    end if;
  end if;

  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists forum_topics_stamp on public.forum_topics;
drop trigger if exists forum_topics_before_write on public.forum_topics;
create trigger forum_topics_before_write
  before insert or update on public.forum_topics
  for each row execute function public.forum_topic_before_write();

-- Changing and deleting: only these columns, only the adder or an admin.
grant update (name, slug, description, details, parent_id) on public.forum_topics to authenticated;
grant delete on public.forum_topics to authenticated;

drop policy if exists "forum_topics: the adder or an admin changes it" on public.forum_topics;
drop policy if exists "forum_topics: the adder or an admin deletes it" on public.forum_topics;

create policy "forum_topics: the adder or an admin changes it" on public.forum_topics
  for update to authenticated
  using ((select auth.uid()) = created_by or (select private.member_role(auth.uid())) = 'admin')
  with check ((select auth.uid()) = created_by or (select private.member_role(auth.uid())) = 'admin');

create policy "forum_topics: the adder or an admin deletes it" on public.forum_topics
  for delete to authenticated
  using ((select auth.uid()) = created_by or (select private.member_role(auth.uid())) = 'admin');

notify pgrst, 'reload schema';
