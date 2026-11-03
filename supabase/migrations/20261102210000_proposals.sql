-- Proposals: ideas for a change that could become a task, if they pass
-- muster (Dane, 2026-11-02, from the WaveCenter task "Create Proposals
-- process (parent task for series)": "A proposal is an idea for a change that
-- could become a task, if it passes muster in the proposals system. To
-- start, a proposal will look just like a task"). He chose a separate record
-- the same day: "Let's make them a separate object ... a proposal is really a
-- different animal." So this is its own table, with a task's fields, and
-- nothing here touches `tasks` or its Proposed status.
--
-- The rules live in core/proposals.ts. The row-level security below repeats
-- who may change what, so a client that went around core still cannot.
-- Making, changing and deleting a proposal is not scored yet; that is a later
-- ticket. Plain-words explanation: docs/DATA_MODEL.md.
--
-- Additive only. Safe to re-run: every statement checks before it creates.

create table if not exists public.proposals (
  id                 uuid        primary key default gen_random_uuid(),
  title              text        not null check (length(btrim(title, E' \t\r\n')) > 0),
  notes              text,
  owner_id           uuid        not null default auth.uid()
                                 references auth.users (id) on delete cascade,
  status             text        not null default 'todo'
                                 check (status in ('todo', 'doing', 'done')),
  parent_proposal_id uuid        references public.proposals (id) on delete set null,
  points             integer     not null default 0 check (points >= 0),
  position           double precision not null default 0,
  priority           text        not null default 'normal'
                                 check (priority in ('urgent', 'high', 'normal', 'low')),
  tool               text        not null default 'wavecenter' check (length(btrim(tool)) > 0),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint proposals_not_own_parent check (parent_proposal_id is distinct from id)
);

-- Engineering rule 2: row-level security is on from the moment the table
-- exists, never as a later retrofit.
alter table public.proposals enable row level security;

create index if not exists proposals_owner_id_idx           on public.proposals (owner_id);
create index if not exists proposals_parent_proposal_id_idx on public.proposals (parent_proposal_id);

-- Who may do what: every signed-in member reads every proposal, as with
-- tasks; a member adds, changes and deletes only their own. Signed-out
-- visitors (the anon role) get nothing. Start from no rights at all (the
-- defaults include TRUNCATE, which ignores row-level security) and grant
-- only the four everyday actions.
revoke all on public.proposals from anon, authenticated;
grant select, insert, update, delete on public.proposals to authenticated;

drop policy if exists "proposals: every member can read" on public.proposals;
drop policy if exists "proposals: owner can insert"      on public.proposals;
drop policy if exists "proposals: owner can update"      on public.proposals;
drop policy if exists "proposals: owner can delete"      on public.proposals;

create policy "proposals: every member can read" on public.proposals
  for select to authenticated using (true);

create policy "proposals: owner can insert" on public.proposals
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "proposals: owner can update" on public.proposals
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "proposals: owner can delete" on public.proposals
  for delete to authenticated
  using ((select auth.uid()) = owner_id);

-- Keep updated_at current on every change, and created_at the database's own.
create or replace function public.proposals_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists proposals_touch on public.proposals;
create trigger proposals_touch
  before insert or update on public.proposals
  for each row execute function public.proposals_touch();

notify pgrst, 'reload schema';
