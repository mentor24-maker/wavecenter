-- The game layer's first piece (Dane, 2026-10-27: "nothing happens within
-- WaveCenter that isn't tracked and scored"; he chose rules + ledger first,
-- values fixed for now). Two tables:
--
--   game_scoring_rules  the kinds of engagement and what each is worth
--                       (after Normie's game_scoring)
--   engagements         the ledger: one row per thing a member did, scored
--
-- The ledger is written by the database itself, by triggers on tasks,
-- task_files and member_settings, inside the same transaction as the change.
-- So a change and its engagement land together or not at all (a failed
-- ledger write fails the change, and the screen says so), a change that went
-- around core is still scored, and no tool or browser can set what an
-- engagement is worth: the points always come from game_scoring_rules. The
-- triggers apply exactly the rules in core/game.ts (engagementKindForTask,
-- recordEngagement); its tests check the kinds and values seeded here.
-- Plain-words explanation: docs/DATA_MODEL.md.
--
-- Additive only: no existing row changes, and nothing is back-filled.
-- Safe to re-run: every statement checks before it creates or replaces.

create table if not exists public.game_scoring_rules (
  kind        text        primary key check (kind ~ '^[a-z_]+$'),
  name        text        not null check (length(btrim(name)) > 0),
  description text        not null default '',
  criteria    text        not null default '',
  points      integer     not null check (points >= 0),
  position    integer     not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Engineering rule 2: row-level security is on from the moment the table
-- exists. Every signed-in member may read the rules. Nobody writes them
-- through the API: until Dane or a vote decides who may, they change only in
-- a migration. Start from no rights at all (Supabase's defaults include
-- TRUNCATE) and grant only reading.
alter table public.game_scoring_rules enable row level security;

revoke all on public.game_scoring_rules from anon, authenticated;
grant select on public.game_scoring_rules to authenticated;

drop policy if exists "game_scoring_rules: members can read" on public.game_scoring_rules;
create policy "game_scoring_rules: members can read" on public.game_scoring_rules
  for select to authenticated
  using (true);

-- Placeholder values until Dane or a vote sets them. Kept in step with
-- STARTING_SCORING_RULES in core/game.ts (a test compares the two). Re-running
-- leaves any value already in the table alone.
insert into public.game_scoring_rules (kind, name, description, criteria, points, position) values
  ('made_task',        'Made a task',                  'Added a task to WaveCenter.',                                            'A new task is saved.',                                                         1, 1),
  ('changed_task',     'Changed a task',               'Edited a task: its title, details, priority, points, place or AI tick.', 'A saved change to a task that neither finishes it nor hands it to AI agents.', 1, 2),
  ('finished_task',    'Finished a task',              'Marked a task done.',                                                    'A task that was not done becomes done.',                                       5, 3),
  ('deleted_task',     'Deleted a task',               'Removed a task.',                                                        'A task is deleted. Its sub-tasks are kept and are not counted.',               1, 4),
  ('attached_file',    'Attached a file',              'Added a file or picture to a task.',                                     'A file is saved on a task.',                                                   1, 5),
  ('removed_file',     'Removed a file',               'Took a file off a task.',                                                'A file is removed from a task on its own, not by deleting the task.',          1, 6),
  ('handed_to_agents', 'Handed a task to AI agents',   'A task you ticked was filed for the AI agents to build.',                'A ticked task is given its Loop Queue ticket.',                                1, 7),
  ('switched_agents',  'Switched AI agents on or off', 'Flipped the Launch AI Agents switch.',                                    'The switch is saved, on or off.',                                              1, 8)
on conflict (kind) do nothing;

create table if not exists public.engagements (
  id         uuid        primary key default gen_random_uuid(),
  -- Who is credited: the member whose task, file or setting changed.
  member_id  uuid        not null references auth.users (id) on delete cascade,
  kind       text        not null references public.game_scoring_rules (kind),
  -- Copied from the rule when it happened, so a later change to a rule
  -- never rewrites what was already earned.
  points     integer     not null,
  tool       text        not null check (length(btrim(tool)) > 0),
  -- The task it was about. Deliberately not a foreign key: the record of a
  -- deleted task's history stays.
  task_id    uuid,
  created_at timestamptz not null default now()
);

create index if not exists engagements_member_created_idx on public.engagements (member_id, created_at desc);

-- Engineering rule 2 again. A member reads only their own engagements;
-- signed-out visitors get nothing; nobody writes, changes or deletes a row
-- through the API, not even their own. Only the triggers below write here.
alter table public.engagements enable row level security;

revoke all on public.engagements from anon, authenticated;
grant select on public.engagements to authenticated;

drop policy if exists "engagements: member reads own" on public.engagements;
create policy "engagements: member reads own" on public.engagements
  for select to authenticated
  using ((select auth.uid()) = member_id);

-- Each member's points total, added up in the database (the API returns at
-- most 1,000 rows at a time, so adding them up on the page would undercount).
-- security_invoker: the view reads engagements as the member asking, so the
-- policy above still lets them see only their own total.
create or replace view public.engagement_totals
with (security_invoker = true) as
  select member_id, sum(points)::bigint as points, count(*)::bigint as engagements
  from public.engagements
  group by member_id;

revoke all on public.engagement_totals from anon, authenticated;
grant select on public.engagement_totals to authenticated;

-- Score one engagement and write it: core/game.ts recordEngagement, in SQL.
-- A kind with no rule is refused, which fails the change that caused it.
-- Runs as the table owner so it can write past row-level security, and only
-- the triggers may call it.
create or replace function public.record_engagement(p_member uuid, p_kind text, p_tool text, p_task uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_points integer;
begin
  select r.points into v_points from public.game_scoring_rules r where r.kind = p_kind;
  if not found then
    raise exception 'There is no scoring rule for "%", so nothing was saved.', p_kind;
  end if;
  insert into public.engagements (member_id, kind, points, tool, task_id)
  values (p_member, p_kind, v_points, p_tool, p_task);
end;
$$;

revoke execute on function public.record_engagement(uuid, text, text, uuid) from public, anon, authenticated;

-- A delete leaves no row to name its tool, so the tool sends it in the
-- x-wavecenter-tool request header (app/lib/taskStore.ts,
-- scripts/lib/restTaskStore.mjs). Without one, the tool that last changed
-- the row is named.
create or replace function public.engagement_tool(p_fallback text)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(btrim(current_setting('request.headers', true)::json ->> 'x-wavecenter-tool'), ''),
    p_fallback
  );
$$;

revoke execute on function public.engagement_tool(text) from public, anon, authenticated;

-- Tasks: made, changed, finished, handed to AI agents, deleted. The same
-- choice as core/game.ts engagementKindForTask. A change made by the database
-- itself on the way to another one (pg_trigger_depth() > 1: a sub-task let go
-- when its parent is deleted, a member's tasks removed with their account)
-- is not a separate engagement.
create or replace function public.tasks_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  if tg_op = 'INSERT' then
    perform public.record_engagement(new.owner_id, 'made_task', new.tool, new.id);
  elsif tg_op = 'DELETE' then
    perform public.record_engagement(old.owner_id, 'deleted_task', public.engagement_tool(old.tool), old.id);
  else
    if new.agent_ticket_url is not null and old.agent_ticket_url is null then
      v_kind := 'handed_to_agents';
    elsif new.status = 'done' and old.status is distinct from 'done' then
      v_kind := 'finished_task';
    else
      v_kind := 'changed_task';
    end if;
    perform public.record_engagement(new.owner_id, v_kind, new.tool, new.id);
  end if;
  return null;
end;
$$;

drop trigger if exists tasks_score on public.tasks;
create trigger tasks_score
  after insert or update or delete on public.tasks
  for each row execute function public.tasks_score();

-- Files: attached, removed. A file row deleted along with its task is part of
-- deleting the task (pg_trigger_depth() > 1), already scored there.
create or replace function public.task_files_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  if tg_op = 'INSERT' then
    perform public.record_engagement(new.owner_id, 'attached_file', new.tool, new.task_id);
  else
    perform public.record_engagement(old.owner_id, 'removed_file', public.engagement_tool(old.tool), old.task_id);
  end if;
  return null;
end;
$$;

drop trigger if exists task_files_score on public.task_files;
create trigger task_files_score
  after insert or delete on public.task_files
  for each row execute function public.task_files_score();

-- The "Launch AI Agents" switch: every save, on or off.
create or replace function public.member_settings_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  perform public.record_engagement(new.owner_id, 'switched_agents', new.tool, null);
  return null;
end;
$$;

drop trigger if exists member_settings_score on public.member_settings;
create trigger member_settings_score
  after insert or update on public.member_settings
  for each row execute function public.member_settings_score();

revoke execute on function public.tasks_score() from public, anon, authenticated;
revoke execute on function public.task_files_score() from public, anon, authenticated;
revoke execute on function public.member_settings_score() from public, anon, authenticated;

notify pgrst, 'reload schema';
