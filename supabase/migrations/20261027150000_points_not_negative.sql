-- A task's points are its suggested value, and a suggested value is never
-- below zero (Dane, 2026-10-27: "an initial suggested score would be
-- inherently positive"). core/points.ts refuses a negative number with a plain
-- message; this makes the table refuse it too, whatever writes to it.
-- Plain-words explanation: docs/DATA_MODEL.md, "Points rules".
--
-- Checked before writing: no task had points below zero (0 of 20 rows,
-- 2026-10-27), so no row is changed. If one ever did, adding the constraint
-- fails rather than quietly rewriting someone's points.
--
-- Safe to re-run: the constraint is only added if it is not already there.

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'tasks_points_not_negative'
       and conrelid = 'public.tasks'::regclass
  ) then
    alter table public.tasks
      add constraint tasks_points_not_negative check (points >= 0);
  end if;
end
$$;
