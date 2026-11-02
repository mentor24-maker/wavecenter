-- Every member may message members (Dane, 2026-11-01, answering "Who may use
-- Send Message on Your profile?" with "B": every member, picking the
-- recipient from a dropdown). Until now only admins had member.message.
--
-- No new table. Reading messages is unchanged: the row-level security rule
-- made with the messages table (20261031150000) lets only the sender and the
-- recipient read a message.
--
-- send_message is replaced for one reason. It hands the recipient's email
-- address back to its caller, so the server can email them. With admins the
-- only callers that was safe; with every member calling it, any member could
-- collect other members' addresses by calling it straight from the API. So it
-- now hands the address back to an admin only. Anyone else's message is
-- saved, shown in Messages, and not emailed, and the form says so
-- (core/messages.ts, mayEmailMessage). A later ticket emails every member's
-- message without the address ever reaching a member's session.
--
-- The rules live in core/members.ts (STARTING_ROLE_PERMISSIONS); a test keeps
-- this file in step with them. Additive and safe to re-run: the insert skips
-- rows already there.

insert into public.role_permissions (role, permission) values
  ('editor',      'member.message'),
  ('contributor', 'member.message'),
  ('reviewer',    'member.message'),
  ('viewer',      'member.message')
on conflict do nothing;

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
  -- The address goes back to an admin only (see the top of this file).
  return query
    select made, case when private.member_role(caller) = 'admin' then u.email::text else null end
      from auth.users u where u.id = recipient;
end;
$$;

revoke execute on function public.send_message(uuid, text, text, text) from public, anon;
grant execute on function public.send_message(uuid, text, text, text) to authenticated;

notify pgrst, 'reload schema';
