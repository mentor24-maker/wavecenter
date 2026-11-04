-- A task's points become its final score (Dane, 2026-11-03: "We will
-- average the AI score and the human score to arrive at the final score.
-- Later, we will add a third factor, which is the average of all the other
-- users' scores."). His answers on "Factor ratings do not set a task's points
-- yet: connect them", 2026-11-04, 12:45 PM MT, were "B" (before the AI has
-- rated a task, its points stand, marked provisional on the task page) and
-- "A", with: "Since the voting is working, the final score is going to be
-- the average of three scores: Owner's score, AI score, Average of other
-- users' scores".
--
-- So, for every task that is not done:
--
--   points = the plain average of the parts it has, a half rounding up:
--     - the AI score: the newest row of ai_task_ratings for it;
--     - the owner's score: tasks.owner_points (null is "not set");
--     - the others' score: the average of the points votes of every member
--       other than the owner, a half rounding up.
--   A part it does not have is left out; with none at all, 0.
--
-- core/taskScore.ts finalScore and othersScore are the same rule.
--
-- What changes:
--
--   1. private.task_final_points works the rule out for one task.
--   2. The owner's score is set whenever the owner's own change names the
--      points, even to the number already there (tasks_owner_points_set),
--      because the owner now types their own score while the task shows the
--      final one. Nobody can write the column straight, as before.
--   3. tasks_points_final keeps every not-done task's points at its final
--      score on every change to it. A task that stays done keeps its points
--      locked; reopening it gives it its final score.
--   4. A new AI rating applies the rule to its task (ai_task_ratings_apply).
--   5. A vote applies the rule (task_votes_apply, replaced): votes no longer
--      replace the owner's points. Priority is the votes' average as before.
--   6. Every open task takes its final score once. No task has an AI rating
--      yet, so an open task's points become the average of its owner's
--      score and its other members' votes. Done tasks keep theirs.
--
-- A change made by the rule is not the owner's doing: it runs with
-- wavecenter.vote_apply on, which tasks_score already reads as "do not score
-- the owner", and which tasks_owner_points and tasks_owner_points_set read as
-- "leave the owner's score alone". The name is older than the AI rating;
-- it now means "the rule, not the owner, is changing this task".
--
-- Plain-words explanation: docs/DATA_MODEL.md. Safe to re-run: every
-- statement replaces or checks before it creates.

-- 1. The rule ------------------------------------------------------------

create or replace function private.task_final_points(p_task uuid, p_owner uuid, p_owner_points integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(round(avg(part))::integer, 0)
    from (
      select p_owner_points::numeric as part
      union all
      select (select r.ai_score::numeric
                from public.ai_task_ratings r
               where r.task_id = p_task
               order by r.created_at desc, r.seq desc
               limit 1)
      union all
      select round(avg(v.points))
        from public.task_votes v
       where v.task_id = p_task
         and v.member_id is distinct from p_owner
         and v.points is not null
    ) parts
   where part is not null;
$$;

revoke execute on function private.task_final_points(uuid, uuid, integer) from public, anon, authenticated;

-- 2. The owner's score --------------------------------------------------

-- On a new task, the owner's score is the points it was made with. On any
-- change, it stays as it was here; tasks_owner_points_set (next) moves it
-- when the owner's own change names the points.
create or replace function public.tasks_owner_points()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.owner_points := nullif(new.points, 0);
  else
    new.owner_points := old.owner_points;
  end if;
  return new;
end;
$$;

-- Runs only when the change names the points column, so the owner typing the
-- number the task already shows still sets their score. Triggers of one
-- kind run in name order: this runs after tasks_owner_points and before
-- tasks_points_final.
create or replace function public.tasks_owner_points_set()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('wavecenter.vote_apply', true), '') <> 'on'
     and not (old.status = 'done' and new.status = 'done') then
    new.owner_points := nullif(new.points, 0);
  end if;
  return new;
end;
$$;

revoke execute on function public.tasks_owner_points_set() from public, anon, authenticated;

drop trigger if exists tasks_owner_points_set on public.tasks;
create trigger tasks_owner_points_set
  before update of points on public.tasks
  for each row execute function public.tasks_owner_points_set();

-- 3. The points are the final score -------------------------------------

-- Security definer because it reads the rule from the private schema, which
-- members cannot reach themselves; it only ever sets this one row's points.
create or replace function public.tasks_points_final()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (old.status = 'done' and new.status = 'done') then
    new.points := private.task_final_points(new.id, new.owner_id, new.owner_points);
  end if;
  return new;
end;
$$;

revoke execute on function public.tasks_points_final() from public, anon, authenticated;

drop trigger if exists tasks_points_final on public.tasks;
create trigger tasks_points_final
  before update on public.tasks
  for each row execute function public.tasks_points_final();

-- 4. A new AI rating ----------------------------------------------------

create or replace function public.ai_task_ratings_apply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('wavecenter.vote_apply', 'on', true);
  update public.tasks t
     set points = private.task_final_points(t.id, t.owner_id, t.owner_points),
         tool   = new.tool
   where t.id = new.task_id
     and t.status <> 'done'
     and t.points is distinct from private.task_final_points(t.id, t.owner_id, t.owner_points);
  perform set_config('wavecenter.vote_apply', 'off', true);
  return null;
end;
$$;

revoke execute on function public.ai_task_ratings_apply() from public, anon, authenticated;

drop trigger if exists ai_task_ratings_apply on public.ai_task_ratings;
create trigger ai_task_ratings_apply
  after insert on public.ai_task_ratings
  for each row execute function public.ai_task_ratings_apply();

-- 5. A vote -------------------------------------------------------------

-- As in 20261028140000_task_votes.sql (the deletes that are not the voter's
-- doing, the voter scored once), except for what lands on the task: its
-- priority is the average of the priority votes, as before, and its points
-- are the final score, worked out again even when the last vote goes.
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
  v_weight integer;
  v_priority text;
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

  select round(avg(case v.priority when 'urgent' then 4 when 'high' then 3 when 'normal' then 2 when 'low' then 1 end))::integer
    into v_weight
    from public.task_votes v
   where v.task_id = v_task;
  v_priority := case v_weight when 4 then 'urgent' when 3 then 'high' when 2 then 'normal' when 1 then 'low' end;

  perform set_config('wavecenter.vote_apply', 'on', true);
  update public.tasks t
     set points   = private.task_final_points(t.id, t.owner_id, t.owner_points),
         priority = coalesce(v_priority, t.priority),
         tool     = v_tool
   where t.id = v_task
     and t.status <> 'done'
     and (t.points   is distinct from private.task_final_points(t.id, t.owner_id, t.owner_points)
       or t.priority is distinct from coalesce(v_priority, t.priority));
  perform set_config('wavecenter.vote_apply', 'off', true);
  return null;
end;
$$;

revoke execute on function public.task_votes_apply() from public, anon, authenticated;

-- 6. Every open task takes its final score once -------------------------

-- Not anyone's action: the rule's own setting keeps the owner unscored and
-- the owner's score as it is; wavecenter.backfill tells tasks_score to
-- score nobody; tasks_touch is held back so no "last changed" time moves.
do $$
begin
  perform set_config('wavecenter.vote_apply', 'on', true);
  perform set_config('wavecenter.backfill', 'on', true);
  alter table public.tasks disable trigger tasks_touch;
  update public.tasks t
     set points = private.task_final_points(t.id, t.owner_id, t.owner_points)
   where t.status <> 'done'
     and t.points is distinct from private.task_final_points(t.id, t.owner_id, t.owner_points);
  alter table public.tasks enable trigger tasks_touch;
  perform set_config('wavecenter.backfill', 'off', true);
  perform set_config('wavecenter.vote_apply', 'off', true);
end;
$$;

notify pgrst, 'reload schema';
