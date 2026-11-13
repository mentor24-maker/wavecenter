-- A chat about a task stays a chat about a task after the task is deleted
-- (WC-175, "Members cannot chat privately about a task: link a chat to it").
--
-- Deleting a task sets its chats' task_id to null (on delete set null, so the
-- conversation is kept). Until now that made a chat about a deleted task look
-- exactly like a plain chat: the chat window could not say "about a deleted
-- task", and start_chat, asked for a plain chat between the same two members,
-- could hand back the old task chat instead of a plain one.
--
-- about_a_task records, once, when the chat is made, whether it was about a
-- task. It never changes, so it survives the task's deletion. start_chat now
-- finds a plain chat only among chats that were never about a task.
--
-- Additive and safe to re-run: the column is added only if missing, the
-- backfill only touches rows not yet marked, and the function is replaced
-- with its grants kept.

alter table public.chats add column if not exists about_a_task boolean not null default false;

-- Every chat that names a task today was made about it.
update public.chats set about_a_task = true where task_id is not null and not about_a_task;

-- A chat that names a task is always marked as about one.
alter table public.chats drop constraint if exists chats_task_means_about_a_task;
alter table public.chats add constraint chats_task_means_about_a_task check (task_id is null or about_a_task);

create or replace function public.start_chat(other_member uuid, about_task uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  found_chat uuid;
begin
  if caller is null then
    raise exception 'You are signed out, so no chat was started.' using errcode = '42501';
  end if;
  if other_member is null or not exists (select 1 from auth.users u where u.id = other_member) then
    raise exception 'There is no such member.' using errcode = '22023';
  end if;
  if other_member = caller then
    raise exception 'You cannot start a chat with yourself.' using errcode = '22023';
  end if;
  if about_task is not null and not exists (select 1 from public.tasks t where t.id = about_task) then
    raise exception 'There is no task of that id you may read, so no chat was started.' using errcode = '22023';
  end if;

  -- Two members starting the same chat at the same moment make one chat,
  -- not two: the second waits for the first, then finds it.
  perform pg_advisory_xact_lock(hashtextextended(
    'start_chat:' || least(caller, other_member)::text || ':' || greatest(caller, other_member)::text || ':' || coalesce(about_task::text, ''), 0));

  -- The chat about this task (or a plain chat, never one whose task was
  -- deleted) whose members are exactly these two.
  select c.id into found_chat
    from public.chats c
   where c.task_id is not distinct from about_task
     and c.about_a_task = (about_task is not null)
     and exists (select 1 from public.chat_members m where m.chat_id = c.id and m.member_id = caller)
     and exists (select 1 from public.chat_members m where m.chat_id = c.id and m.member_id = other_member)
     and (select count(*) from public.chat_members m where m.chat_id = c.id) = 2
   order by c.created_at
   limit 1;
  if found_chat is not null then
    return found_chat;
  end if;

  insert into public.chats (task_id, about_a_task, created_by) values (about_task, about_task is not null, caller) returning id into found_chat;
  insert into public.chat_members (chat_id, member_id) values (found_chat, caller), (found_chat, other_member);
  return found_chat;
end;
$$;

revoke execute on function public.start_chat(uuid, uuid) from public, anon;
grant execute on function public.start_chat(uuid, uuid) to authenticated;
