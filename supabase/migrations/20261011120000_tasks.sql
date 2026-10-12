-- The task record: WaveCenter's first table, and the seed of the engagement
-- ledger. From version one every task carries an owner, a status, a parent
-- task and a points value (CLAUDE.md, "What we are building").
-- Plain-words explanation: docs/DATA_MODEL.md.
--
-- Safe to re-run: every statement checks before it creates or replaces.

create table if not exists public.tasks (
  id             uuid        primary key default gen_random_uuid(),
  title          text        not null check (length(btrim(title)) > 0),
  notes          text,
  owner_id       uuid        not null default auth.uid()
                             references auth.users (id) on delete cascade,
  status         text        not null default 'todo'
                             check (status in ('todo', 'doing', 'done')),
  parent_task_id uuid        references public.tasks (id) on delete set null,
  points         integer     not null default 0,
  position       double precision not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  completed_at   timestamptz,
  constraint tasks_not_own_parent check (parent_task_id is distinct from id)
);

-- Engineering rule 2: row-level security is on from the moment the table
-- exists, never as a later retrofit.
alter table public.tasks enable row level security;

create index if not exists tasks_owner_id_idx       on public.tasks (owner_id);
create index if not exists tasks_parent_task_id_idx on public.tasks (parent_task_id);

-- Who may do what: a signed-in member reads and writes only their own rows.
-- Signed-out visitors (the anon role) get nothing at all. The service role
-- bypasses these rules and stays on the server (engineering rule 3).
-- Supabase's defaults also hand out TRUNCATE, which empties the whole table
-- and ignores row-level security, so start from nothing and grant only the
-- four everyday actions.
revoke all on public.tasks from anon, authenticated;
grant select, insert, update, delete on public.tasks to authenticated;

drop policy if exists "tasks: owner can read"   on public.tasks;
drop policy if exists "tasks: owner can insert" on public.tasks;
drop policy if exists "tasks: owner can update" on public.tasks;
drop policy if exists "tasks: owner can delete" on public.tasks;

create policy "tasks: owner can read" on public.tasks
  for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy "tasks: owner can insert" on public.tasks
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "tasks: owner can update" on public.tasks
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "tasks: owner can delete" on public.tasks
  for delete to authenticated
  using ((select auth.uid()) = owner_id);

-- Keep updated_at current on every change, and completed_at in step with the
-- status: stamped when a task becomes done, cleared if it is reopened.
create or replace function public.tasks_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_touch on public.tasks;
create trigger tasks_touch
  before insert or update on public.tasks
  for each row execute function public.tasks_touch();
