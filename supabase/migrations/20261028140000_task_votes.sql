-- Members vote on what a task is worth and how urgent it is (Dane,
-- 2026-10-27: "allow all users to vote on all tasks in terms of priority and
-- point values ... The actual value will be the average of all users' votes.
-- (for now)"). On the ticket he settled: votes go on the task list, every
-- member sees every task including its notes and files, and once members have
-- voted the average replaces the owner's own points and priority.
--
-- Three things change:
--
--   1. Every signed-in member can READ every task, every file row and every
--      stored file. Adding, changing and deleting stay owner-only.
--   2. A new table, task_votes: one row per member per task.
--   3. After every vote the database sets the task's points and priority to
--      the average (core/votes.ts votedValues), and scores the vote for the
--      voter (core/game.ts, kind voted_on_task), in the same save. It has to
--      be the database: a member voting on someone else's task may not write
--      that task themselves.
--
-- Plain-words explanation: docs/DATA_MODEL.md. Additive only: no existing row
-- changes. Safe to re-run: every statement checks before it creates or
-- replaces.

-- 1. Every member reads everything --------------------------------------

drop policy if exists "tasks: owner can read"   on public.tasks;
drop policy if exists "tasks: members can read" on public.tasks;
create policy "tasks: members can read" on public.tasks
  for select to authenticated
  using (true);

drop policy if exists "task_files: owner can read"   on public.task_files;
drop policy if exists "task_files: members can read" on public.task_files;
create policy "task_files: members can read" on public.task_files
  for select to authenticated
  using (true);

-- Reading a stored file (and getting a signed link to it) is open to every
-- member; adding and deleting stay inside the member's own folder.
drop policy if exists "task-files: owner can read"   on storage.objects;
drop policy if exists "task-files: members can read" on storage.objects;
create policy "task-files: members can read" on storage.objects
  for select to authenticated
  using (bucket_id = 'task-files');

-- 2. The votes ---------------------------------------------------------

create table if not exists public.task_votes (
  task_id    uuid        not null references public.tasks (id) on delete cascade,
  member_id  uuid        not null default auth.uid()
                         references auth.users (id) on delete cascade,
  -- Either part may be left out; a vote with neither is withdrawn (deleted).
  points     integer     check (points >= 0),
  priority   text        check (priority in ('urgent', 'high', 'normal', 'low')),
  tool       text        not null default 'wavecenter' check (length(btrim(tool)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (task_id, member_id),
  constraint task_votes_not_empty check (points is not null or priority is not null)
);

-- Engineering rule 2: row-level security is on from the moment the table
-- exists. Every member reads every vote; a member adds, changes and withdraws
-- only their own. Start from no rights (Supabase's defaults include TRUNCATE)
-- and grant only the four everyday actions.
alter table public.task_votes enable row level security;

create index if not exists task_votes_member_id_idx on public.task_votes (member_id);

revoke all on public.task_votes from anon, authenticated;
grant select, insert, update, delete on public.task_votes to authenticated;

drop policy if exists "task_votes: members can read"  on public.task_votes;
drop policy if exists "task_votes: voter can insert"  on public.task_votes;
drop policy if exists "task_votes: voter can update"  on public.task_votes;
drop policy if exists "task_votes: voter can delete"  on public.task_votes;

create policy "task_votes: members can read" on public.task_votes
  for select to authenticated
  using (true);

create policy "task_votes: voter can insert" on public.task_votes
  for insert to authenticated
  with check ((select auth.uid()) = member_id);

create policy "task_votes: voter can update" on public.task_votes
  for update to authenticated
  using ((select auth.uid()) = member_id)
  with check ((select auth.uid()) = member_id);

create policy "task_votes: voter can delete" on public.task_votes
  for delete to authenticated
  using ((select auth.uid()) = member_id);

create or replace function public.task_votes_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists task_votes_touch on public.task_votes;
create trigger task_votes_touch
  before update on public.task_votes
  for each row execute function public.task_votes_touch();

-- 3. Scoring the vote and applying the average --------------------------

-- Kept in step with STARTING_SCORING_RULES in core/game.ts (a test compares
-- the two). Position 9 is taken by the profile rule (open PR #30, already
-- applied). Re-running leaves any value already in the table alone.
insert into public.game_scoring_rules (kind, name, description, criteria, points, position) values
  ('voted_on_task',    'Voted on a task',              'Voted on what a task is worth or how urgent it is.',                    'A vote on a task is cast, changed or withdrawn.',                              1, 10)
on conflict (kind) do nothing;

-- tasks_score, as in 20261027130000_game_layer_cascades.sql, plus one
-- check: an update made by the vote trigger below is not the owner's doing.
create or replace function public.tasks_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_owner uuid := coalesce(new.owner_id, old.owner_id);
begin
  -- The member's account is being deleted, and their tasks with it.
  if not exists (select 1 from auth.users u where u.id = v_owner) then
    return null;
  end if;
  -- The vote trigger (task_votes_apply) is putting the members' average on
  -- the task: that is the voter's engagement, already scored, not the
  -- owner's.
  if coalesce(current_setting('wavecenter.vote_apply', true), '') = 'on' then
    return null;
  end if;
  if tg_op = 'INSERT' then
    perform public.record_engagement(new.owner_id, 'made_task', new.tool, new.id);
  elsif tg_op = 'DELETE' then
    perform public.record_engagement(old.owner_id, 'deleted_task', public.engagement_tool(old.tool), old.id);
  else
    -- Its parent was just deleted and the database let it go: that delete
    -- was the engagement, already scored.
    if old.parent_task_id is not null and new.parent_task_id is null
       and not exists (select 1 from public.tasks t where t.id = old.parent_task_id) then
      return null;
    end if;
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

revoke execute on function public.tasks_score() from public, anon, authenticated;

-- core/votes.ts votedValues, in SQL: points are the average of the points
-- votes, priority the average of the priority votes counted urgent 4, high 3,
-- normal 2, low 1, each rounded to the nearest whole number with a half
-- rounding up. A part nobody has voted on keeps the task's own value. A done
-- task's points are locked, so its votes change nothing.
--
-- Two kinds of vote removal are not the voter's doing, and Postgres runs
-- both at the same trigger depth as an ordinary withdrawal (see
-- 20261027130000_game_layer_cascades.sql), so they are told apart by what
-- still exists:
--   - the task is being deleted: its votes go with it, nothing to score or
--     average;
--   - the voter's account is being deleted: nothing is scored (the ledger
--     can only credit a real account), but the task's average is worked out
--     again without that vote.
--
-- The average lands on the task with the vote's own tool, but it is the
-- voter's contribution, not the owner's: the transaction-local setting
-- wavecenter.vote_apply tells tasks_score (above) not to score that update
-- as the owner changing their task. The task is only written when its points
-- or priority actually move.
create or replace function public.task_votes_apply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task   uuid;
  v_member uuid;
  v_tool   text;
  v_points integer;
  v_weight integer;
  v_priority text;
  v_voters integer;
begin
  if tg_op = 'DELETE' then
    v_task := old.task_id; v_member := old.member_id; v_tool := public.engagement_tool(old.tool);
  else
    v_task := new.task_id; v_member := new.member_id; v_tool := new.tool;
  end if;

  -- The task is being deleted, and its votes with it.
  if not exists (select 1 from public.tasks t where t.id = v_task) then
    return null;
  end if;

  -- The voter's account is being deleted: nobody to credit.
  if exists (select 1 from auth.users u where u.id = v_member) then
    perform public.record_engagement(v_member, 'voted_on_task', v_tool, v_task);
  end if;

  select count(*),
         round(avg(v.points))::integer,
         round(avg(case v.priority when 'urgent' then 4 when 'high' then 3 when 'normal' then 2 when 'low' then 1 end))::integer
    into v_voters, v_points, v_weight
    from public.task_votes v
   where v.task_id = v_task;

  if v_voters > 0 then
    v_priority := case v_weight when 4 then 'urgent' when 3 then 'high' when 2 then 'normal' when 1 then 'low' end;
    perform set_config('wavecenter.vote_apply', 'on', true);
    update public.tasks t
       set points   = coalesce(v_points, t.points),
           priority = coalesce(v_priority, t.priority),
           tool     = v_tool
     where t.id = v_task
       and t.status <> 'done'
       and (t.points   is distinct from coalesce(v_points, t.points)
         or t.priority is distinct from coalesce(v_priority, t.priority));
    perform set_config('wavecenter.vote_apply', 'off', true);
  end if;
  return null;
end;
$$;

revoke execute on function public.task_votes_apply() from public, anon, authenticated;

drop trigger if exists task_votes_apply on public.task_votes;
create trigger task_votes_apply
  after insert or update or delete on public.task_votes
  for each row execute function public.task_votes_apply();

notify pgrst, 'reload schema';
