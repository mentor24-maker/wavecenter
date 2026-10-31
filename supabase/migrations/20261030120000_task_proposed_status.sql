-- A Proposed status (WaveCenter task, 2026-10-30: "A 'proposed' task is not
-- automatically submitted for development. It requires approval by an Admin.
-- Any task added by a user that is not an admin, is initially set to
-- 'proposed' status."). The rules live in core/tasks.ts (createTask,
-- updateTask, approveTask); this file repeats them so a client that went
-- around core still cannot skip the approval:
--
--   - a task added by a member who is not an admin is saved as proposed,
--     whatever status the client sent;
--   - only an admin moves a task out of proposed, and only through
--     approve_task below, which makes it todo;
--   - a proposed task can never be ticked for, or handed to, AI agents.
--
-- Additive only: the status check gains one value and every existing row
-- keeps its status. Row-level security on tasks is untouched and stays on.
-- Safe to re-run: every statement checks before it creates or replaces.

-- The status check, widened. Postgres named the original inline check
-- tasks_status_check (20261011120000_tasks.sql).
alter table public.tasks drop constraint if exists tasks_status_check;
alter table public.tasks add constraint tasks_status_check
  check (status in ('proposed', 'todo', 'doing', 'done'));

alter table public.tasks drop constraint if exists tasks_proposed_not_with_agents;
alter table public.tasks add constraint tasks_proposed_not_with_agents
  check (status <> 'proposed' or (not agent_selected and agent_ticket_url is null));

-- Who may leave proposed. Work with the service key (the hand-off lane, a
-- migration) has no signed-in member and is trusted, as everywhere else; an
-- admin may do anything. Anyone else's new task becomes proposed, and their
-- proposed task stays proposed.
create or replace function public.tasks_proposed_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null or private.member_role(caller) = 'admin' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.status := 'proposed';
    new.agent_selected := false;
    new.agent_ticket_url := null;
  elsif old.status = 'proposed' and new.status is distinct from 'proposed' then
    raise exception 'This task is still Proposed. An admin needs to approve it before its status can change.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.tasks_proposed_guard() from public, anon, authenticated;

drop trigger if exists tasks_proposed_guard on public.tasks;
create trigger tasks_proposed_guard
  before insert or update on public.tasks
  for each row execute function public.tasks_proposed_guard();

-- The one way a proposed task is approved: by an admin, on any member's
-- task, naming the tool. It returns the approved task, or no row if the task
-- is no longer proposed (approved already, or deleted). The game layer
-- scores the change for the task's owner, as for any change to their task.
create or replace function public.approve_task(task uuid, tool text)
returns setof public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'You are signed out, so no task was approved.' using errcode = '42501';
  end if;
  if approve_task.tool is null or length(btrim(approve_task.tool)) = 0 then
    raise exception 'Every change must name the tool making it, and none was given.' using errcode = '22023';
  end if;
  if private.member_role(caller) <> 'admin' then
    raise exception 'Only an admin can approve a proposed task.' using errcode = '42501';
  end if;
  return query
    update public.tasks t
       set status = 'todo', tool = btrim(approve_task.tool)
     where t.id = approve_task.task and t.status = 'proposed'
    returning t.*;
end;
$$;

revoke execute on function public.approve_task(uuid, text) from public, anon;
grant execute on function public.approve_task(uuid, text) to authenticated;

notify pgrst, 'reload schema';
