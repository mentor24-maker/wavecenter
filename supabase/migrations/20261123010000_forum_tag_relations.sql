-- A Forum tag's details, related tags, and changing and deleting a tag
-- (WC-186, Dane, 2026-11-22: "Give Tags a CRUD Table. Instead of Parent,
-- include a Related Tags column, which can display a list of tags."). On the
-- ticket he chose "B": a tag's page is like a topic's, with a name, slug,
-- description and rich-text details, plus its related tags. Who may change
-- or delete a tag is the same as for a topic (WC-183, "A"): the member who
-- added it, and admins.
--
-- New columns on forum_tags (row-level security is already on, from the
-- migration that made the table):
--
--   slug         the tag's short web-address name: lower-case letters,
--                digits and single hyphens, unique among tags. Made from the
--                name when a tag is added without one; existing tags get theirs here.
--   description  one plain line, at most 500 characters ('' when none)
--   details      rich text in the task comments' format (core/richText.ts),
--                plain words never HTML, at most 10,000 characters
--   updated_at   when it was last changed; the database stamps it
--
-- One new table, row-level security on in the same migration that makes it
-- (engineering rule 2):
--
--   forum_tag_relations  two tags that belong together. A relation is
--                        two-way and stored ONCE, with the smaller id first
--                        (tag_id < related_tag_id), so it cannot be stored
--                        twice or relate a tag to itself. Read both ways:
--                        relate Voting to Budget and Budget shows Voting.
--                        Deleting either tag deletes the relation.
--
-- forum_tag_save() changes a tag and replaces its related tags in one go, so
-- a save is all or nothing. It runs as the signed-in member (security
-- invoker): row-level security decides, exactly as for a direct write.
--
-- The rules live in core/forum.ts; the database repeats them so a client that
-- went around core still cannot break them. Additive and safe to re-run.

alter table public.forum_tags add column if not exists slug        text;
alter table public.forum_tags add column if not exists description text not null default '';
alter table public.forum_tags add column if not exists details     text not null default '';
alter table public.forum_tags add column if not exists updated_at  timestamptz;

-- The slug a tag's name suggests: the same as a topic's (core's topicSlug()),
-- but "tag" if nothing is left.
create or replace function public.forum_tag_slug_from(name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    nullif(rtrim(left(btrim(regexp_replace(lower(coalesce(name, '')), '[^a-z0-9]+', '-', 'g'), '-'), 80), '-'), ''),
    'tag');
$$;

-- `base`, or base-2, base-3 ... whichever no other tag's slug is.
create or replace function public.forum_tag_unique_slug(base text, self uuid)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  candidate text := base;
  n int := 1;
begin
  while exists (select 1 from public.forum_tags t where t.slug = candidate and t.id is distinct from self) loop
    n := n + 1;
    candidate := rtrim(left(base, 80 - length('-' || n)), '-') || '-' || n;
  end loop;
  return candidate;
end;
$$;

revoke execute on function public.forum_tag_slug_from(text) from public, anon;
revoke execute on function public.forum_tag_unique_slug(text, uuid) from public, anon;
grant execute on function public.forum_tag_slug_from(text) to authenticated;
grant execute on function public.forum_tag_unique_slug(text, uuid) to authenticated;

-- Existing tags get a slug from their name, oldest first.
do $$
declare
  r record;
begin
  for r in select id, name from public.forum_tags where slug is null order by created_at, id loop
    update public.forum_tags
       set slug = public.forum_tag_unique_slug(public.forum_tag_slug_from(r.name), r.id)
     where id = r.id;
  end loop;
end;
$$;

update public.forum_tags set updated_at = created_at where updated_at is null;
alter table public.forum_tags alter column updated_at set default now();
alter table public.forum_tags alter column updated_at set not null;
alter table public.forum_tags alter column slug set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'forum_tags_slug_shape') then
    alter table public.forum_tags add constraint forum_tags_slug_shape
      check (length(slug) between 1 and 80 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'forum_tags_description_shape') then
    alter table public.forum_tags add constraint forum_tags_description_shape
      check (length(description) <= 500 and description !~ '[\r\n]');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'forum_tags_details_length') then
    alter table public.forum_tags add constraint forum_tags_details_length
      check (length(details) <= 10000);
  end if;
end;
$$;

create unique index if not exists forum_tags_slug_key on public.forum_tags (slug);

-- Before a tag is added or changed: give it a slug if it has none and stamp
-- when it changed. It never touches created_by: members cannot write that
-- column at all (the column grants below), and leaving it alone keeps
-- "on delete set null" working when an adder's account goes.
create or replace function public.forum_tag_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.slug is null or btrim(new.slug) = '' then
    new.slug := public.forum_tag_unique_slug(public.forum_tag_slug_from(new.name), new.id);
  end if;
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists forum_tags_stamp on public.forum_tags;
drop trigger if exists forum_tags_before_write on public.forum_tags;
create trigger forum_tags_before_write
  before insert or update on public.forum_tags
  for each row execute function public.forum_tag_before_write();

-- Changing and deleting a tag: only these columns, only the adder or an admin.
grant update (name, slug, description, details) on public.forum_tags to authenticated;
grant delete on public.forum_tags to authenticated;

drop policy if exists "forum_tags: the adder or an admin changes it" on public.forum_tags;
drop policy if exists "forum_tags: the adder or an admin deletes it" on public.forum_tags;

create policy "forum_tags: the adder or an admin changes it" on public.forum_tags
  for update to authenticated
  using ((select auth.uid()) = created_by or (select private.member_role(auth.uid())) = 'admin')
  with check ((select auth.uid()) = created_by or (select private.member_role(auth.uid())) = 'admin');

create policy "forum_tags: the adder or an admin deletes it" on public.forum_tags
  for delete to authenticated
  using ((select auth.uid()) = created_by or (select private.member_role(auth.uid())) = 'admin');

-- Related tags.
create table if not exists public.forum_tag_relations (
  tag_id         uuid        not null references public.forum_tags (id) on delete cascade,
  related_tag_id uuid        not null references public.forum_tags (id) on delete cascade,
  -- Who related them; set by the database to whoever is signed in.
  created_by     uuid        default auth.uid() references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  primary key (tag_id, related_tag_id),
  -- Stored once, smaller id first: never twice, never a tag with itself.
  constraint forum_tag_relations_once check (tag_id < related_tag_id)
);

alter table public.forum_tag_relations enable row level security;

create index if not exists forum_tag_relations_related_idx on public.forum_tag_relations (related_tag_id);

revoke all on public.forum_tag_relations from anon, authenticated;
grant select, delete on public.forum_tag_relations to authenticated;
grant insert (tag_id, related_tag_id) on public.forum_tag_relations to authenticated;

drop policy if exists "forum_tag_relations: every member can read" on public.forum_tag_relations;
drop policy if exists "forum_tag_relations: whoever may change either tag relates them" on public.forum_tag_relations;
drop policy if exists "forum_tag_relations: whoever may change either tag unrelates them" on public.forum_tag_relations;

create policy "forum_tag_relations: every member can read" on public.forum_tag_relations
  for select to authenticated using (true);

-- Editing a tag's related tags is changing that tag, so whoever may change
-- either of the two tags may add or remove the relation between them.
create policy "forum_tag_relations: whoever may change either tag relates them" on public.forum_tag_relations
  for insert to authenticated
  with check (
    (select auth.uid()) = created_by
    and (
      (select private.member_role(auth.uid())) = 'admin'
      or exists (select 1 from public.forum_tags t
                  where t.id in (tag_id, related_tag_id) and t.created_by = (select auth.uid()))
    )
  );

create policy "forum_tag_relations: whoever may change either tag unrelates them" on public.forum_tag_relations
  for delete to authenticated
  using (
    (select private.member_role(auth.uid())) = 'admin'
    or exists (select 1 from public.forum_tags t
                where t.id in (tag_id, related_tag_id) and t.created_by = (select auth.uid()))
  );

-- When a relation was made is the database's own.
create or replace function public.forum_tag_relation_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists forum_tag_relations_stamp on public.forum_tag_relations;
create trigger forum_tag_relations_stamp
  before insert on public.forum_tag_relations
  for each row execute function public.forum_tag_relation_stamp();

-- Change a tag and set its related tags, all or nothing. The member's own
-- rights apply (security invoker). A tag they may not change, or one that is
-- gone, raises no_data_found rather than quietly saving nothing (rule 6).
-- Relating a tag to itself breaks the "once" check; a tag that is not there
-- breaks the foreign key; either undoes the whole save.
create or replace function public.forum_tag_save(
  p_id uuid, p_name text, p_slug text, p_description text, p_details text, p_related uuid[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.forum_tags
     set name = p_name, slug = p_slug, description = p_description, details = p_details
   where id = p_id;
  if not found then
    raise exception 'The tag was not saved: it may have been deleted, or you may not be allowed to change it.'
      using errcode = 'no_data_found';
  end if;

  delete from public.forum_tag_relations where tag_id = p_id or related_tag_id = p_id;

  insert into public.forum_tag_relations (tag_id, related_tag_id)
  select distinct
         case when r.id < p_id then r.id else p_id end,
         case when r.id < p_id then p_id else r.id end
    from unnest(coalesce(p_related, '{}'::uuid[])) as r(id);
end;
$$;

revoke execute on function public.forum_tag_save(uuid, text, text, text, text, uuid[]) from public, anon;
grant execute on function public.forum_tag_save(uuid, text, text, text, text, uuid[]) to authenticated;

notify pgrst, 'reload schema';
