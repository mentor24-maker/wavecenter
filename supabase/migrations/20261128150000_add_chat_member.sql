-- A chat member can bring one more person into a chat (WC-256, "Let a chat
-- member add one more person to a chat"), so a conversation can grow
-- without starting over in a new chat.
--
-- add_chat_member(chat, new_member) repeats core's rules (core/chat.ts,
-- addChatMemberProblem), in the same order, and refuses in plain words:
--
--   - the caller must be signed in;
--   - the caller must already be in the chat (a chat that does not exist is
--     refused the same way, so nobody learns which chats exist);
--   - the new person must be a member who exists;
--   - the new person must not be in the chat already;
--   - the chat must stay within 10 members (CHAT_MEMBERS_MAX).
--
-- A two-person chat may grow into a group of three, and a chat about a task
-- may grow too. The person added reads the whole chat from then on, earlier
-- messages included: the read rules (20261112120000_chats.sql) let any
-- member of a chat read all of it. Their last_read_at starts empty, so the
-- chat shows as unread for them until they open it
-- (20261113150000_chat_unread.sql).
--
-- Adds to one chat are taken one at a time (a lock on the chat), so two
-- members adding at the same moment can never take it past the limit.
--
-- Not a scored action. Row-level security on the chat tables does not
-- change: still no direct writes, only these functions. No new table. Safe
-- to re-run.

create or replace function public.add_chat_member(chat uuid, new_member uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  members_now integer;
begin
  if caller is null then
    raise exception 'You are signed out, so nobody was added.' using errcode = '42501';
  end if;

  -- One add to this chat at a time, so the size check below holds.
  perform pg_advisory_xact_lock(hashtextextended('add_chat_member:' || coalesce(chat::text, ''), 0));

  if chat is null or not private.in_chat(chat, caller) then
    raise exception 'You are not in that chat, so nobody was added.' using errcode = '42501';
  end if;
  if new_member is null or not exists (select 1 from auth.users u where u.id = new_member) then
    raise exception 'There is no such member, so nobody was added.' using errcode = '22023';
  end if;
  if private.in_chat(chat, new_member) then
    raise exception 'That member is already in this chat, so nobody was added.' using errcode = '22023';
  end if;
  select count(*) into members_now from public.chat_members m where m.chat_id = chat;
  if members_now + 1 > 10 then
    raise exception 'A chat can have at most 10 members, so nobody was added.' using errcode = '22023';
  end if;

  insert into public.chat_members (chat_id, member_id) values (chat, new_member);
  return chat;
end;
$$;

revoke execute on function public.add_chat_member(uuid, uuid) from public, anon;
grant execute on function public.add_chat_member(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
