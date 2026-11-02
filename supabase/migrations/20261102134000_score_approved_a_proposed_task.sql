-- "Approved a proposed task" now earns its points (Dane, 2026-11-01: "1
-- point per task is fine for now"). The sweep listed it
-- (20261102120000_scoring_actions_sweep.sql) but nothing recorded it, so it
-- showed "Not active yet". Core's side is approveTask in core/tasks.ts;
-- SCORING_TRIGGERS in core/game.ts names this function and its test.
--
-- What counts: a proposed task becomes a to-do, which approve_task
-- (20261030120000_task_proposed_status.sql) does and only an admin may do.
-- Credited to the admin who approved it, the signed-in member, never the
-- task's owner. The owner keeps the "Changed a task" that tasks_score
-- records for the same save, as before. A task moved out of proposed with
-- the service key has no signed-in member to credit, so it is saved
-- unscored rather than refused.
--
-- The engagement is written inside the same save as the approval, so if it
-- cannot be written the task stays proposed. No new table. Safe to re-run.

create or replace function public.tasks_score_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is not null then
    perform public.record_engagement(caller, 'approved_a_proposed_task', new.tool, new.id);
  end if;
  return null;
end;
$$;

drop trigger if exists tasks_score_approval on public.tasks;
create trigger tasks_score_approval
  after update of status on public.tasks
  for each row
  when (old.status = 'proposed' and new.status = 'todo')
  execute function public.tasks_score_approval();

revoke execute on function public.tasks_score_approval() from public, anon, authenticated;

notify pgrst, 'reload schema';
