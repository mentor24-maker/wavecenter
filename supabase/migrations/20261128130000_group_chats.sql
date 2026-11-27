-- A Comm chat can include more than two members (WC-252, "Let a Comm chat
-- include more than two members"). chat_members was a list from the start
-- (20261112120000_chats.sql), so no table changes: only the one way a chat
-- is made.
--
-- start_chat(other_members uuid[], about_task uuid) is the new form: it takes
-- everyone the caller wants in the chat besides themself, repeats core's
-- rules (core/chat.ts, startChatProblem) and refuses in plain words:
--
--   - at least one other member;
--   - no more than 10 members, the caller included (CHAT_MEMBERS_MAX);
--   - every one a member who exists;
--   - not the caller themself;
--   - nobody twice.
--
-- It finds a chat by its whole set of members, about the same task (or none,
-- never one whose task was deleted), so starting the same group again opens
-- the one already there, whoever of them starts it. The lock is taken on the
-- whole set too, so two members starting the same group at the same moment
-- make one chat. For two members the lock key is exactly the one the old
-- function took.
--
-- The two-person form, start_chat(other_member uuid, about_task uuid), still
-- works for the task page and the Members page: it is now a thin call to the
-- list form with one member, so the two keep one set of rules.
--
-- started_a_chat is still scored once, only for a new chat: chats_score
-- (20261123130000_score_started_a_chat.sql) fires on the insert, which only
-- happens when no chat was found.
--
-- No new table. Who may read a chat does not change. Safe to re-run.

create or replace function public.start_chat(other_members uuid[], about_task uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  others uuid[] := coalesce(other_members, '{}');
  everyone uuid[];
  found_chat uuid;
begin
  if caller is null then
    raise exception 'You are signed out, so no chat was started.' using errcode = '42501';
  end if;
  if cardinality(others) = 0 then
    raise exception 'Pick at least one other member to chat with.' using errcode = '22023';
  end if;
  if cardinality(others) + 1 > 10 then
    raise exception 'A chat can have at most 10 members, you included, so no chat was started.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(others) o where o is null or not exists (select 1 from auth.users u where u.id = o)) then
    raise exception 'There is no such member.' using errcode = '22023';
  end if;
  if caller = any (others) then
    raise exception 'You cannot start a chat with yourself.' using errcode = '22023';
  end if;
  if (select count(distinct o) from unnest(others) o) <> cardinality(others) then
    raise exception 'The same member was picked twice, so no chat was started.' using errcode = '22023';
  end if;
  if about_task is not null and not exists (select 1 from public.tasks t where t.id = about_task) then
    raise exception 'There is no task of that id you may read, so no chat was started.' using errcode = '22023';
  end if;

  everyone := array(select m from unnest(others || caller) m order by m);

  -- Members starting the same chat at the same moment make one chat, not
  -- several: each after the first waits, then finds it.
  perform pg_advisory_xact_lock(hashtextextended(
    'start_chat:' || array_to_string(everyone, ':') || ':' || coalesce(about_task::text, ''), 0));

  -- The chat about this task (or a plain chat, never one whose task was
  -- deleted) whose members are exactly these.
  select c.id into found_chat
    from public.chats c
   where c.task_id is not distinct from about_task
     and c.about_a_task = (about_task is not null)
     and (select count(*) from public.chat_members m where m.chat_id = c.id and m.member_id = any (everyone)) = cardinality(everyone)
     and (select count(*) from public.chat_members m where m.chat_id = c.id) = cardinality(everyone)
   order by c.created_at
   limit 1;
  if found_chat is not null then
    return found_chat;
  end if;

  insert into public.chats (task_id, about_a_task, created_by) values (about_task, about_task is not null, caller) returning id into found_chat;
  insert into public.chat_members (chat_id, member_id) select found_chat, m from unnest(everyone) m;
  return found_chat;
end;
$$;

revoke execute on function public.start_chat(uuid[], uuid) from public, anon;
grant execute on function public.start_chat(uuid[], uuid) to authenticated;

-- The two-person form, kept for the task page and the Members page: the
-- list form with one member, so both follow the same rules.
create or replace function public.start_chat(other_member uuid, about_task uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.start_chat(array[other_member], about_task);
end;
$$;

revoke execute on function public.start_chat(uuid, uuid) from public, anon;
grant execute on function public.start_chat(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
