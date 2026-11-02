-- Every member's message is emailed, not only an admin's, and no member's
-- session is ever handed an email address.
--
-- Until now send_message handed the recipient's address back to its caller
-- (an admin only, since 20261101130000), so the server could email them.
-- Now the server looks the address up itself, with the server-only service
-- key (engineering rule 3: that key never reaches the browser), through
-- message_recipient_email below, which no member's session may call.
--
-- So send_message is remade to hand back the new message's id only, for every
-- caller, an admin too. Its return shape changes, which Postgres allows only
-- by removing the old function first; the checks inside are unchanged.
-- No new table. Safe to re-run.

drop function if exists public.send_message(uuid, text, text, text);

create function public.send_message(recipient uuid, subject text, body text, tool text)
returns table (id uuid)
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
  return query select made;
end;
$$;

revoke execute on function public.send_message(uuid, text, text, text) from public, anon;
grant execute on function public.send_message(uuid, text, text, text) to authenticated;

-- The recipient's address for one message, for the server to email it. Only
-- the service key may call it: Supabase grants new functions to anon and
-- authenticated by default, so both are taken away by name. It answers only
-- for a message `sender` sent whose email is still pending, so even the
-- server cannot use it as a general address lookup. Null when there is no
-- such message or the recipient has no address.
--
-- One member may have at most 20 messages emailed an hour, so nobody can use
-- WaveCenter to flood inboxes or spend its email allowance. Past that it
-- refuses with the code WC429; the message stays saved in WaveCenter.
-- It counts every message the sender saved in the last hour, whatever its
-- email status, not only the ones already emailed: a row turns 'sent' only
-- after the email goes, so 50 sends fired at once would each count 0 and
-- all go out, and a sender could mark its own rows 'failed' to hide them.
-- Every message is saved before its lookup runs, so of any burst at most
-- 20 lookups ever see fewer than 20 others.
create or replace function public.message_recipient_email(message uuid, sender uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  address text;
begin
  select u.email::text into address
    from public.messages m
    join auth.users u on u.id = m.recipient_id
   where m.id = message and m.sender_id = sender and m.email_status = 'pending';
  if address is null then
    return null;
  end if;
  if (select count(*) from public.messages m
       where m.sender_id = sender and m.id <> message and m.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'You have sent 20 messages in the last hour, so this one was not emailed. It is saved in WaveCenter; try again later.'
      using errcode = 'WC429';
  end if;
  return address;
end;
$$;

revoke execute on function public.message_recipient_email(uuid, uuid) from public, anon, authenticated;
grant execute on function public.message_recipient_email(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
