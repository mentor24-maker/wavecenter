-- Messages between members (Dane, 2026-10-30: "On the Members page, add an
-- email icon to the Actions column. Clicking it opens a simple message form,
-- including subject field. Sending the message will email the message to the
-- user and also store it in a messages table on WaveCenter"). He chose Resend
-- to send the email, the same evening.
--
-- One new permission, admins only to start:
--
--   member.message  Message members  admin only
--
-- One new table, `messages`, with row-level security on from the moment it is
-- made. The sender and the recipient read a message; nobody else does, and
-- nobody writes the table directly. A message is saved only through
-- `send_message`, which repeats core's rules (core/messages.ts), and its email
-- result only through `record_message_email`, which only its sender may call.
--
-- `send_message` hands back the recipient's email address, so the server can
-- email them. Only a role with member.message may call it, and every call
-- leaves a stored message, so no address is ever read without a record of
-- who read it and why. `list_members` still carries no address.
--
-- Every trim strips spaces, tabs and line breaks, not just spaces, so a
-- subject that is only a newline is refused here as it is in core, whose
-- trim() strips all of them.
--
-- Additive and safe to re-run: every create checks first, every insert skips
-- rows already there.

insert into public.permissions (key, label, position) values
  ('member.message', 'Message members', 7)
on conflict (key) do nothing;

insert into public.role_permissions (role, permission) values
  ('admin', 'member.message')
on conflict do nothing;

create table if not exists public.messages (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid not null references auth.users (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  subject      text not null check (length(btrim(subject, E' \t\n\r\f\x0B')) between 1 and 200),
  body         text not null check (length(btrim(body, E' \t\n\r\f\x0B')) between 1 and 10000),
  tool         text not null check (length(btrim(tool, E' \t\n\r\f\x0B')) > 0),
  -- pending until the server reports how the email went: sent, or failed.
  email_status text not null default 'pending' check (email_status in ('pending', 'sent', 'failed')),
  emailed_at   timestamptz,
  created_at   timestamptz not null default now()
);

-- Row-level security in the same step that makes the table (engineering rule 2).
alter table public.messages enable row level security;

create index if not exists messages_recipient_idx on public.messages (recipient_id, created_at desc);
create index if not exists messages_sender_idx on public.messages (sender_id, created_at desc);

-- The sender and the recipient read a message. No insert, update or delete
-- rule: without one, nobody writes the table from the API.
drop policy if exists "messages: sender or recipient can read" on public.messages;
create policy "messages: sender or recipient can read" on public.messages
  for select to authenticated
  using ((select auth.uid()) = sender_id or (select auth.uid()) = recipient_id);

-- The one way a message is saved. Returns the new message's id and the
-- recipient's email address (null if they have none).
create or replace function public.send_message(recipient uuid, subject text, body text, tool text)
returns table (id uuid, recipient_email text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  made uuid;
begin
  if caller is null then
    raise exception 'You are signed out, so no message was sent.' using errcode = '42501';
  end if;
  if tool is null or length(btrim(tool, E' \t\n\r\f\x0B')) = 0 then
    raise exception 'Every change must name the tool making it, and none was given.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.role_permissions rp
     where rp.role = private.member_role(caller) and rp.permission = 'member.message'
  ) then
    raise exception 'Your role may not message members.' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u where u.id = recipient) then
    raise exception 'There is no such member.' using errcode = '22023';
  end if;
  if subject is null or length(btrim(subject, E' \t\n\r\f\x0B')) = 0 then
    raise exception 'A message needs a subject.' using errcode = '22023';
  end if;
  if body is null or length(btrim(body, E' \t\n\r\f\x0B')) = 0 then
    raise exception 'A message needs some text.' using errcode = '22023';
  end if;
  insert into public.messages (sender_id, recipient_id, subject, body, tool)
  values (caller, recipient, btrim(subject, E' \t\n\r\f\x0B'), btrim(body, E' \t\n\r\f\x0B'), btrim(tool, E' \t\n\r\f\x0B'))
  returning messages.id into made;
  return query select made, u.email::text from auth.users u where u.id = recipient;
end;
$$;

-- Record how the email went. Only the message's sender, and only once: a
-- message that is already sent or failed keeps that answer.
create or replace function public.record_message_email(message uuid, status text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  now_status text;
begin
  if auth.uid() is null then
    raise exception 'You are signed out, so nothing was recorded.' using errcode = '42501';
  end if;
  if status not in ('sent', 'failed') then
    raise exception '"%" is not an email result.', status using errcode = '22023';
  end if;
  update public.messages m
     set email_status = status, emailed_at = case when status = 'sent' then now() else null end
   where m.id = message and m.sender_id = auth.uid() and m.email_status = 'pending'
  returning m.email_status into now_status;
  if now_status is null then
    raise exception 'No pending message of yours has that id.' using errcode = '22023';
  end if;
  return now_status;
end;
$$;

revoke execute on function public.send_message(uuid, text, text, text) from public, anon;
grant execute on function public.send_message(uuid, text, text, text) to authenticated;
revoke execute on function public.record_message_email(uuid, text) from public, anon;
grant execute on function public.record_message_email(uuid, text) to authenticated;

notify pgrst, 'reload schema';
