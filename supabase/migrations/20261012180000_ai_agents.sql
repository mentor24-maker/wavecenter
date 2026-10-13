-- Handing tasks to AI agents (Dane, 2026-10-12): every task gets a priority
-- and an "AI works on this" tick, and each member gets a "Launch AI Agents"
-- switch. Agents take ticked tasks highest priority first, then oldest first
-- (core/agents.ts). Plain-words explanation: docs/DATA_MODEL.md.
--
-- Additive only: existing tasks become normal priority and unticked.
-- Safe to re-run: every statement checks before it creates.

alter table public.tasks
  add column if not exists priority text not null default 'normal';
alter table public.tasks drop constraint if exists tasks_priority_valid;
alter table public.tasks
  add constraint tasks_priority_valid check (priority in ('urgent', 'high', 'normal', 'low'));

alter table public.tasks
  add column if not exists agent_selected boolean not null default false;

-- One row per member, for settings that belong to the member rather than to
-- a task. The first is the "Launch AI Agents" switch.
create table if not exists public.member_settings (
  owner_id   uuid        primary key default auth.uid()
                         references auth.users (id) on delete cascade,
  agents_on  boolean     not null default false,
  tool       text        not null default 'wavecenter'
                         check (length(btrim(tool)) > 0),
  updated_at timestamptz not null default now()
);

-- Engineering rule 2: row-level security is on from the moment the table
-- exists. A member reads and writes only their own row; signed-out visitors
-- get nothing. As with tasks, start from no rights at all (Supabase's
-- defaults include TRUNCATE) and grant only what is used.
alter table public.member_settings enable row level security;

revoke all on public.member_settings from anon, authenticated;
grant select, insert, update on public.member_settings to authenticated;

drop policy if exists "member_settings: owner can read"   on public.member_settings;
drop policy if exists "member_settings: owner can insert" on public.member_settings;
drop policy if exists "member_settings: owner can update" on public.member_settings;

create policy "member_settings: owner can read" on public.member_settings
  for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy "member_settings: owner can insert" on public.member_settings
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "member_settings: owner can update" on public.member_settings
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create or replace function public.member_settings_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists member_settings_touch on public.member_settings;
create trigger member_settings_touch
  before insert or update on public.member_settings
  for each row execute function public.member_settings_touch();
