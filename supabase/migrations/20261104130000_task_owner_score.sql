-- The owner's score: the points a task's own creator gives it, kept apart
-- from the task's points (Dane, 2026-11-03: "We will also have a
-- human-produced score, in the form of the score the person who creates the
-- task gives it. We will average the AI score and the human score to arrive
-- at the final score.").
--
-- Until now the task kept one number. Once members voted, their average
-- overwrote it (task_votes_apply, 20261028140000_task_votes.sql) and the
-- owner's own number was gone. Now:
--
--   1. A new column, tasks.owner_points. Null means "not set". A column on
--      tasks rather than a table of its own: there is exactly one per task,
--      it lives and dies with the task, and it inherits the task's
--      row-level security (every member reads, only the owner writes)
--      without a second set of policies to keep in step.
--   2. The database keeps it, so no path can get it wrong: whenever the
--      owner's own change moves a task's points, the owner's score follows
--      (an owner's 0 counts as "not set"); a vote putting the members'
--      average on the task never touches it; nobody writes it directly.
--      core/points.ts ownerScore is the same rule, and core's in-memory
--      store applies it through that function.
--   3. Existing tasks are filled by Dane's answers on the design
--      (docs/GLOBULAR_SCORING_ALGORITHM.md, questions 7 and 8, "7A, 8A",
--      2026-11-04): a task's owner's score is its points as they stand now,
--      votes' average included, and a task at 0 points is "not set".
--
-- The task's points work exactly as before in this step; sub-ticket 4 makes
-- them the average of the AI score and this owner's score.
--
-- Plain-words explanation: docs/DATA_MODEL.md. Safe to re-run: the fill
-- runs only in the run that adds the column.

-- 1 and 3. The column, filled once --------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'tasks' and column_name = 'owner_points'
  ) then
    alter table public.tasks
      add column owner_points integer check (owner_points > 0);

    -- Filling the column is not anyone's action: wavecenter.backfill tells
    -- tasks_score to score nobody, and tasks_touch is held back so no
    -- task's "last changed" time moves.
    perform set_config('wavecenter.backfill', 'on', true);
    alter table public.tasks disable trigger tasks_touch;
    update public.tasks set owner_points = nullif(points, 0);
    alter table public.tasks enable trigger tasks_touch;
    perform set_config('wavecenter.backfill', 'off', true);
  end if;
end;
$$;

comment on column public.tasks.owner_points is
  'The owner''s score: the points the task''s creator gave it, or null when not set (an owner''s 0 is not set). Kept by tasks_owner_points; votes never change it.';

-- 2. The database keeps it ----------------------------------------------

-- On a new task, the owner's score is the points it was made with. On a
-- change, it follows the points only when the owner's own change moved them;
-- the vote trigger's update (wavecenter.vote_apply, set by
-- task_votes_apply) leaves it as it was, and so does any change that leaves
-- the points alone, including a direct write to the column itself.
create or replace function public.tasks_owner_points()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.owner_points := nullif(new.points, 0);
  elsif coalesce(current_setting('wavecenter.vote_apply', true), '') <> 'on'
        and new.points is distinct from old.points then
    new.owner_points := nullif(new.points, 0);
  else
    new.owner_points := old.owner_points;
  end if;
  return new;
end;
$$;

revoke execute on function public.tasks_owner_points() from public, anon, authenticated;

drop trigger if exists tasks_owner_points on public.tasks;
create trigger tasks_owner_points
  before insert or update on public.tasks
  for each row execute function public.tasks_owner_points();

notify pgrst, 'reload schema';
