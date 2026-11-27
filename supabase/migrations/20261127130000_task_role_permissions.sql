-- The task permissions a role holds decide what its members may do on tasks
-- (Dane, 2026-11-26, WC-248: "Make the task permissions in roles actually
-- decide what members do ... an editor or admin edits and deletes any task,
-- a reviewer or viewer cannot add tasks, and a contributor keeps editing only
-- their own."). Until now task.read, task.create, task.edit and task.delete
-- were stored and shown, but the tasks rules ignored them: every member read
-- every task and changed only their own.
--
-- What changes:
--
--   1. Two new permissions tell "your own task" from "anyone's task":
--        task.edit.any    Edit anyone's task     admin, editor
--        task.delete.any  Delete anyone's task   admin, editor
--      Contributors are granted task.delete, so they keep deleting their own
--      tasks, as they could before. A permission key may now have more than
--      one dot.
--   2. The four tasks policies ask the member's role (private.may, the same
--      helper the teams, Home boxes and website rules use):
--        read    a role with task.read
--        add     a role with task.create, and the new task is the member's
--        change  your own with task.edit; anyone's with task.edit.any
--        delete  your own with task.delete; anyone's with task.delete.any
--   3. Two guards on a change, because an editor may now change someone
--      else's task:
--        - nobody signed in changes a task's owner;
--        - only the owner names a task's points, so the owner's score
--          (owner_points) stays the owner's own. The rule's own updates
--          (the vote and AI rating triggers, wavecenter.vote_apply) and the
--          service key (no signed-in member) are not refused.
--
-- core/tasks.ts and core/members.ts hold the same rules; the database
-- repeats them so a client that went around core still cannot break them.
-- scripts/check_tasks_rls.mjs checks each role.
--
-- Plain-words explanation: docs/DATA_MODEL.md, "Roles and permissions".
-- Safe to re-run: every statement checks before it creates or replaces.

-- 1. The permissions ----------------------------------------------------

alter table public.permissions drop constraint if exists permissions_key_check;
alter table public.permissions add constraint permissions_key_check
  check (key ~ '^[a-z]+(\.[a-z_]+)+$');

insert into public.permissions (key, label, position) values
  ('task.edit.any', 'Edit anyone''s task', 13),
  ('task.delete.any', 'Delete anyone''s task', 14)
on conflict (key) do nothing;

insert into public.role_permissions (role, permission) values
  ('admin', 'task.edit.any'),
  ('admin', 'task.delete.any'),
  ('editor', 'task.edit.any'),
  ('editor', 'task.delete.any'),
  ('contributor', 'task.delete')
on conflict do nothing;

-- 2. The tasks rules ----------------------------------------------------

drop policy if exists "tasks: members can read"   on public.tasks;
drop policy if exists "tasks: owner can insert"   on public.tasks;
drop policy if exists "tasks: owner can update"   on public.tasks;
drop policy if exists "tasks: owner can delete"   on public.tasks;
drop policy if exists "tasks: a role with Read task reads"                     on public.tasks;
drop policy if exists "tasks: a role with Create task adds their own"          on public.tasks;
drop policy if exists "tasks: Edit task changes your own, Edit anyone's any"   on public.tasks;
drop policy if exists "tasks: Delete task deletes your own, Delete anyone's any" on public.tasks;

-- The inner selects make Postgres work out the caller's grants once per
-- query, not once per row.
create policy "tasks: a role with Read task reads" on public.tasks
  for select to authenticated
  using ((select private.may('task.read')));

create policy "tasks: a role with Create task adds their own" on public.tasks
  for insert to authenticated
  with check ((select auth.uid()) = owner_id and (select private.may('task.create')));

create policy "tasks: Edit task changes your own, Edit anyone's any" on public.tasks
  for update to authenticated
  using (((select auth.uid()) = owner_id and (select private.may('task.edit'))) or (select private.may('task.edit.any')))
  with check (((select auth.uid()) = owner_id and (select private.may('task.edit'))) or (select private.may('task.edit.any')));

create policy "tasks: Delete task deletes your own, Delete anyone's any" on public.tasks
  for delete to authenticated
  using (((select auth.uid()) = owner_id and (select private.may('task.delete'))) or (select private.may('task.delete.any')));

-- 3. The guards ---------------------------------------------------------

-- A task's owner is who made it. Before, the update rule's own check kept it
-- so; now that an editor may change anyone's task, a trigger does.
create or replace function public.tasks_owner_kept()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null and new.owner_id is distinct from old.owner_id then
    raise exception 'A task''s owner cannot change. Nothing was saved.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.tasks_owner_kept() from public, anon, authenticated;

drop trigger if exists tasks_owner_kept on public.tasks;
create trigger tasks_owner_kept
  before update of owner_id on public.tasks
  for each row execute function public.tasks_owner_kept();

-- Runs only when a change names the points column: that is the owner setting
-- their score (tasks_owner_points_set), so nobody else may. The rule's own
-- updates run with wavecenter.vote_apply on; the service key has no
-- signed-in member.
create or replace function public.tasks_points_owner_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and auth.uid() is distinct from old.owner_id
     and coalesce(current_setting('wavecenter.vote_apply', true), '') <> 'on' then
    raise exception 'Only a task''s owner can change its points. Nothing was saved.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.tasks_points_owner_only() from public, anon, authenticated;

drop trigger if exists tasks_points_owner_only on public.tasks;
create trigger tasks_points_owner_only
  before update of points on public.tasks
  for each row execute function public.tasks_points_owner_only();

notify pgrst, 'reload schema';
