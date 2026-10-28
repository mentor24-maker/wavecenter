-- A Discussion thread on every task (Dane, 2026-10-27: "Add a Discussion
-- section for each item, in basic discussion forum format"). He chose
-- comments only for now, no automatic history entries. One row per comment;
-- core/comments.ts is the only path that writes them. A comment written by
-- any tool other than WaveCenter's own app counts as AI. Plain-words
-- explanation: docs/DATA_MODEL.md.
--
-- Additive only. Safe to re-run: every statement checks before it creates.

create table if not exists public.task_comments (
  id         uuid        primary key default gen_random_uuid(),
  -- Deleting a task deletes its comments.
  task_id    uuid        not null references public.tasks (id) on delete cascade,
  owner_id   uuid        not null default auth.uid()
                         references auth.users (id) on delete cascade,
  -- Plain text, at most 10,000 characters, the same limit core/comments.ts checks.
  body       text        not null check (length(btrim(body)) > 0 and length(body) <= 10000),
  tool       text        not null default 'wavecenter' check (length(btrim(tool)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Engineering rule 2: row-level security is on from the moment the table
-- exists. As with tasks and task_files, start from no rights at all
-- (Supabase's defaults include TRUNCATE) and grant only what is used. An
-- edit may change only the words and the tool that changed them: a comment
-- never moves to another task or another author.
alter table public.task_comments enable row level security;

create index if not exists task_comments_task_created_idx on public.task_comments (task_id, created_at);
create index if not exists task_comments_owner_id_idx     on public.task_comments (owner_id);

revoke all on public.task_comments from anon, authenticated;
grant select, insert, delete on public.task_comments to authenticated;
grant update (body, tool) on public.task_comments to authenticated;

drop policy if exists "task_comments: owner can read"   on public.task_comments;
drop policy if exists "task_comments: owner can insert" on public.task_comments;
drop policy if exists "task_comments: owner can update" on public.task_comments;
drop policy if exists "task_comments: owner can delete" on public.task_comments;

create policy "task_comments: owner can read" on public.task_comments
  for select to authenticated
  using ((select auth.uid()) = owner_id);

-- A member may only comment on a task of their own.
create policy "task_comments: owner can insert" on public.task_comments
  for insert to authenticated
  with check (
    (select auth.uid()) = owner_id
    and exists (select 1 from public.tasks t where t.id = task_id and t.owner_id = (select auth.uid()))
  );

create policy "task_comments: owner can update" on public.task_comments
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "task_comments: owner can delete" on public.task_comments
  for delete to authenticated
  using ((select auth.uid()) = owner_id);

-- Keep updated_at current on every edit, so the thread can say "edited".
create or replace function public.task_comments_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists task_comments_touch on public.task_comments;
create trigger task_comments_touch
  before update on public.task_comments
  for each row execute function public.task_comments_touch();

revoke execute on function public.task_comments_touch() from public, anon, authenticated;

notify pgrst, 'reload schema';
