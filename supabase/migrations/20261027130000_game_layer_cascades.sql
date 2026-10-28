-- Fix to 20261027120000_game_layer.sql, found by `npm run check:tasks-rls`
-- against the live database the same day. That migration skipped the
-- database's own follow-on changes with pg_trigger_depth(), but Postgres runs
-- those follow-on changes (a deleted task letting go of its sub-tasks, a
-- deleted account's rows going with it) at the same depth as the change that
-- caused them, so:
--
--   - deleting a task with sub-tasks also scored one "changed a task" for
--     each sub-task, and
--   - deleting a member's account failed outright, because the ledger tried
--     to credit an engagement to the member being deleted.
--
-- These replace the three trigger functions with checks that say what they
-- mean: a sub-task whose parent no longer exists was let go by the delete;
-- a file whose task no longer exists went with the task; a member whose
-- account no longer exists earns nothing. Each was already counted, or is
-- nobody's to count. Safe to re-run.

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

create or replace function public.task_files_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.record_engagement(new.owner_id, 'attached_file', new.tool, new.task_id);
  -- A file whose task is gone went with the task (or with the member's
  -- account): deleting the task was the engagement.
  elsif exists (select 1 from public.tasks t where t.id = old.task_id) then
    perform public.record_engagement(old.owner_id, 'removed_file', public.engagement_tool(old.tool), old.task_id);
  end if;
  return null;
end;
$$;

create or replace function public.member_settings_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.record_engagement(new.owner_id, 'switched_agents', new.tool, null);
  return null;
end;
$$;

revoke execute on function public.tasks_score() from public, anon, authenticated;
revoke execute on function public.task_files_score() from public, anon, authenticated;
revoke execute on function public.member_settings_score() from public, anon, authenticated;
