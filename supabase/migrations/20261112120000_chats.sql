-- Live chat between members, the records it is built on (Dane, 2026-11-12:
-- "Is it possible on our platform to develop a real-time chat feature in
-- WaveCenter? So two WaveCenter users could chat with each other in
-- real-time in a dedicated window." On who may chat: "Any two members, for
-- now." On chat beside tasks: "Chat's next to and about tasks would be
-- ideal."). No screen yet: the chat window is its own ticket.
--
-- Separate from `messages` (20261031150000_messages.sql), which is a one-way,
-- emailed message with a subject. Nothing here touches that table.
--
-- Three new tables, each with row-level security on from the moment it is
-- made (engineering rule 2):
--
--   chats          one conversation; task_id says which task it is about
--                  (null: a plain chat)
--   chat_members   who is in it. A table, not two columns, so group chats
--                  can come later without a rebuild
--   chat_messages  what was said, by whom, through which tool
--
-- A member reads a chat, its member list and its messages only when they
-- are in that chat. Nobody writes any of the three directly: a chat is made
-- only through start_chat, and a message saved only through
-- send_chat_message, which repeat core's rules (core/chat.ts).
--
-- Every message is scored for its sender, inside the same save
-- (chat_messages_score): the new granular action `sent_a_chat_message`,
-- with its four factor scores and their reasons
-- (docs/GRANULAR_SCORING_ALGORITHM.md). If the engagement cannot be written,
-- the message is not saved either.
--
-- chat_messages joins the supabase_realtime publication, so the chat window
-- can show a new message the moment it is saved. Realtime honours the read
-- rule below: a member is only sent the messages of chats they are in.
--
-- Additive and safe to re-run: every create checks first, every insert skips
-- rows already there.

create table if not exists public.chats (
  id         uuid primary key default gen_random_uuid(),
  -- The task the chat is about; null for a plain chat. Deleting the task
  -- keeps the conversation.
  task_id    uuid references public.tasks (id) on delete set null,
  created_at timestamptz not null default now(),
  -- Who started it. Deleting their account keeps the chat for the others.
  created_by uuid references auth.users (id) on delete set null
);

create table if not exists public.chat_members (
  chat_id   uuid not null references public.chats (id) on delete cascade,
  member_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (chat_id, member_id)
);

create table if not exists public.chat_messages (
  id         uuid primary key default gen_random_uuid(),
  chat_id    uuid not null references public.chats (id) on delete cascade,
  sender_id  uuid not null references auth.users (id) on delete cascade,
  body       text not null check (length(btrim(body, E' \t\n\r\f\x0B')) between 1 and 4000),
  created_at timestamptz not null default now(),
  tool       text not null check (length(btrim(tool, E' \t\n\r\f\x0B')) > 0)
);

-- Row-level security in the same step that makes the tables (engineering rule 2).
alter table public.chats enable row level security;
alter table public.chat_members enable row level security;
alter table public.chat_messages enable row level security;

-- Start from no rights at all (Supabase's defaults include insert, update,
-- delete and truncate) and grant only reading.
revoke all on public.chats, public.chat_members, public.chat_messages from anon, authenticated;
grant select on public.chats, public.chat_members, public.chat_messages to authenticated;

create index if not exists chat_members_member_idx on public.chat_members (member_id);
create index if not exists chat_messages_chat_idx on public.chat_messages (chat_id, created_at);
create index if not exists chats_task_idx on public.chats (task_id);

-- Is `member` in `chat`? A security-definer helper, so the read rule on
-- chat_members can ask about chat_members without calling itself.
create or replace function private.in_chat(chat uuid, member uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.chat_members cm where cm.chat_id = chat and cm.member_id = member);
$$;

revoke execute on function private.in_chat(uuid, uuid) from public, anon;
grant execute on function private.in_chat(uuid, uuid) to authenticated;

-- A member reads a chat, who is in it, and what was said, only when they are
-- in it. No insert, update or delete rule: without one, nobody writes these
-- tables from the API.
drop policy if exists "chats: members of the chat can read" on public.chats;
create policy "chats: members of the chat can read" on public.chats
  for select to authenticated
  using (private.in_chat(id, (select auth.uid())));

drop policy if exists "chat_members: members of the chat can read" on public.chat_members;
create policy "chat_members: members of the chat can read" on public.chat_members
  for select to authenticated
  using (private.in_chat(chat_id, (select auth.uid())));

drop policy if exists "chat_messages: members of the chat can read" on public.chat_messages;
create policy "chat_messages: members of the chat can read" on public.chat_messages
  for select to authenticated
  using (private.in_chat(chat_id, (select auth.uid())));

-- The one way a chat is made. Returns the chat for the caller and
-- `other_member` about `about_task` (null: a plain chat): the one already
-- there, or a new one. Either member starting it finds the same chat.
--
-- Refuses a chat with yourself, a member who does not exist, and a task the
-- caller may not read. Today every member reads every task
-- ("tasks: members can read", 20261028140000_task_votes.sql), so a task the
-- caller may not read is one that does not exist; if that read rule ever
-- narrows, this check must narrow with it.
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

  -- The chat about this task (or about none) whose members are exactly
  -- these two.
  select c.id into found_chat
    from public.chats c
   where c.task_id is not distinct from about_task
     and exists (select 1 from public.chat_members m where m.chat_id = c.id and m.member_id = caller)
     and exists (select 1 from public.chat_members m where m.chat_id = c.id and m.member_id = other_member)
     and (select count(*) from public.chat_members m where m.chat_id = c.id) = 2
   order by c.created_at
   limit 1;
  if found_chat is not null then
    return found_chat;
  end if;

  insert into public.chats (task_id, created_by) values (about_task, caller) returning id into found_chat;
  insert into public.chat_members (chat_id, member_id) values (found_chat, caller), (found_chat, other_member);
  return found_chat;
end;
$$;

-- The one way a chat message is saved, from the signed-in member. Returns the
-- new message's id. Refuses a member who is not in the chat, an empty or
-- over-long message, and a message that names no tool. The text is saved
-- with the spaces and line breaks at either end trimmed, as core does.
create or replace function public.send_chat_message(chat uuid, body text, tool text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  made uuid;
  clean text := btrim(coalesce(body, ''), E' \t\n\r\f\x0B');
begin
  if caller is null then
    raise exception 'You are signed out, so no message was sent.' using errcode = '42501';
  end if;
  if tool is null or length(btrim(tool, E' \t\n\r\f\x0B')) = 0 then
    raise exception 'Every change must name the tool making it, and none was given.' using errcode = '22023';
  end if;
  if chat is null or not private.in_chat(chat, caller) then
    raise exception 'You are not in that chat, so no message was sent.' using errcode = '42501';
  end if;
  if length(clean) = 0 then
    raise exception 'A chat message needs some text.' using errcode = '22023';
  end if;
  if length(clean) > 4000 then
    raise exception 'The message is too long: keep it to 4000 characters or fewer.' using errcode = '22023';
  end if;
  insert into public.chat_messages (chat_id, sender_id, body, tool)
  values (chat, caller, clean, btrim(tool, E' \t\n\r\f\x0B'))
  returning chat_messages.id into made;
  return made;
end;
$$;

revoke execute on function public.start_chat(uuid, uuid) from public, anon;
grant execute on function public.start_chat(uuid, uuid) to authenticated;
revoke execute on function public.send_chat_message(uuid, text, text) from public, anon;
grant execute on function public.send_chat_message(uuid, text, text) to authenticated;

-- The game layer: "Sent a chat message", a new granular action. Points by
-- the formula, 1 + E + 2 x V + R = 1 + 1 + 2 + 0 = 4, the same as "Send a
-- message to another member"; the factors and their reasons are the rows
-- docs/GRANULAR_SCORING_ALGORITHM.md gives it (a test keeps the two in step).
-- Goes after whatever is on the list already. A kind already there is left
-- alone.
insert into public.game_scoring_rules (
  kind, name, description, criteria, points, position,
  effort, value, rarity, farm_risk,
  effort_reason, value_reason, rarity_reason, farm_risk_reason
)
select v.kind, v.name, v.description, v.criteria, v.points,
       (select coalesce(max(r.position), 0) from public.game_scoring_rules r) + v.ord,
       v.effort, v.value, v.rarity, v.farm_risk,
       v.effort_reason, v.value_reason, v.rarity_reason, v.farm_risk_reason
  from (values
  ('sent_a_chat_message', 'Sent a chat message', 'Wrote a message in a chat with another member.', 'A chat message is saved.', 4, 1,
   1, 1, 0, 2,
   'A few words: under a minute.',
   'Helps the other member in the chat, not the shared record.',
   'Members can send chat messages many times a day.',
   'Repeatable in seconds, but a chat message cannot be edited or deleted, so it cannot loop.')
  ) as v (kind, name, description, criteria, points, ord, effort, value, rarity, farm_risk, effort_reason, value_reason, rarity_reason, farm_risk_reason)
on conflict (kind) do nothing;

-- Every saved chat message is recorded inside the same save, credited to its
-- sender and naming its tool: core/chat.ts sendChatMessage, in SQL. A message
-- is saved only through send_chat_message, so a refused one saves nothing
-- and scores nothing.
create or replace function public.chat_messages_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.record_engagement(new.sender_id, 'sent_a_chat_message', new.tool, null);
  return null;
end;
$$;

drop trigger if exists chat_messages_score on public.chat_messages;
create trigger chat_messages_score
  after insert on public.chat_messages
  for each row execute function public.chat_messages_score();

revoke execute on function public.chat_messages_score() from public, anon, authenticated;

-- Live updates for the chat window. Supabase makes this publication on every
-- project; it is made here only if it is missing.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end;
$$;

notify pgrst, 'reload schema';
