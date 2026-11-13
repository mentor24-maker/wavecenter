-- Unread chat messages (WC-176, "Members cannot tell when a chat message is
-- waiting: show unread count"). A chat is only real-time if the other member
-- knows a message arrived (Dane, 2026-11-12: "So two WaveCenter users could
-- chat with each other in real-time in a dedicated window").
--
-- chat_members gains last_read_at: when this member last read this chat
-- (null: never). A message is unread for a member when it is newer than
-- their last_read_at and they did not send it, the rule core/chat.ts
-- `isUnreadChatMessage` holds too.
--
-- Two functions:
--
--   mark_chat_read(chat)  sets last_read_at to now for the CALLER only, and
--                         refuses anyone not in the chat. The only way the
--                         column changes: chat_members still has no update
--                         rule, so nobody writes it directly.
--   my_chat_unread()      for the caller, each chat with unread messages and
--                         how many. Runs as the caller (security invoker), so
--                         row-level security keeps it to their own chats.
--
-- Marking a chat read is not scored: it is not an engagement a member
-- chooses (the ticket's non-goal).
--
-- Additive and safe to re-run.

alter table public.chat_members add column if not exists last_read_at timestamptz;

-- Counting a member's unread messages reads their newest messages per chat.
create index if not exists chat_messages_chat_sender_idx on public.chat_messages (chat_id, created_at, sender_id);

create or replace function public.mark_chat_read(chat uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  read_at timestamptz := now();
begin
  if caller is null then
    raise exception 'You are signed out, so the chat was not marked read.' using errcode = '42501';
  end if;
  if chat is null or not private.in_chat(chat, caller) then
    raise exception 'You are not in that chat, so it was not marked read.' using errcode = '42501';
  end if;
  update public.chat_members cm
     set last_read_at = read_at
   where cm.chat_id = chat and cm.member_id = caller;
  if not found then
    raise exception 'The chat was not marked read. Try again.' using errcode = 'P0002';
  end if;
  return read_at;
end;
$$;

revoke execute on function public.mark_chat_read(uuid) from public, anon;
grant execute on function public.mark_chat_read(uuid) to authenticated;

create or replace function public.my_chat_unread()
returns table (chat_id uuid, unread integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select cm.chat_id, count(*)::integer as unread
    from public.chat_members cm
    join public.chat_messages msg on msg.chat_id = cm.chat_id
   where cm.member_id = (select auth.uid())
     and msg.sender_id <> cm.member_id
     and (cm.last_read_at is null or msg.created_at > cm.last_read_at)
   group by cm.chat_id;
$$;

revoke execute on function public.my_chat_unread() from public, anon;
grant execute on function public.my_chat_unread() to authenticated;

notify pgrst, 'reload schema';
