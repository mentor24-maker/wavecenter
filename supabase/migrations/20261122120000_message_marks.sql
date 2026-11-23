-- Star and Trash on a message (WC-180, "On Profile > Messages, places
-- messages in CRUD table"; Dane: "Include an action column for reply, flag,
-- and trash"). On the ticket, 2026-11-22, Dane chose "A": both are private to
-- the member who clicks them, and "Flag is intended to mean as 'important',
-- not 'bad'. Let's come up with a better term for that." So the flag is a
-- Star: the member's own mark that a message matters.
--
-- One new table, `message_marks`: one row per member per message, holding
-- whether that member starred it and when they put it in their trash (null:
-- not in the trash). Row-level security is on from the moment it is made
-- (engineering rule 2). A member reads only their own marks; nobody writes the
-- table directly. A mark changes only through `set_message_mark`, which
-- refuses a message the caller neither sent nor received.
--
-- Trash never deletes a message and never changes what the other member
-- sees: the message row is untouched, and the other member's marks are
-- theirs alone. Marking is not scored.
--
-- Additive and safe to re-run.

create table if not exists public.message_marks (
  message_id uuid not null references public.messages (id) on delete cascade,
  member_id  uuid not null references auth.users (id) on delete cascade,
  starred    boolean not null default false,
  trashed_at timestamptz,
  tool       text not null check (length(btrim(tool, E' \t\n\r\f\x0B')) > 0),
  updated_at timestamptz not null default now(),
  primary key (message_id, member_id)
);

-- Row-level security in the same step that makes the table (engineering rule 2).
alter table public.message_marks enable row level security;

create index if not exists message_marks_member_idx on public.message_marks (member_id);

-- A member reads their own marks. No insert, update or delete rule: without
-- one, nobody writes the table from the API.
drop policy if exists "message_marks: a member reads their own" on public.message_marks;
create policy "message_marks: a member reads their own" on public.message_marks
  for select to authenticated
  using ((select auth.uid()) = member_id);

-- The one way a mark changes, for the caller only. `star` and `trash`
-- null leave that part as it is. Returns the mark as now saved.
create or replace function public.set_message_mark(message uuid, star boolean, trash boolean, tool text)
returns table (message_id uuid, starred boolean, trashed_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'You are signed out, so nothing was changed.' using errcode = '42501';
  end if;
  if tool is null or length(btrim(tool, E' \t\n\r\f\x0B')) = 0 then
    raise exception 'Every change must name the tool making it, and none was given.' using errcode = '22023';
  end if;
  if star is null and trash is null then
    raise exception 'Nothing to change was given.' using errcode = '22023';
  end if;
  if message is null or not exists (
    select 1 from public.messages m
     where m.id = message and (m.sender_id = caller or m.recipient_id = caller)
  ) then
    raise exception 'You did not send or receive that message, so it was not changed.' using errcode = '42501';
  end if;
  insert into public.message_marks as mk (message_id, member_id, starred, trashed_at, tool)
  values (
    message, caller, coalesce(star, false),
    case when trash then now() else null end,
    btrim(tool, E' \t\n\r\f\x0B')
  )
  on conflict on constraint message_marks_pkey do update
     set starred    = coalesce(star, mk.starred),
         trashed_at = case
                        when trash is null then mk.trashed_at
                        when trash then coalesce(mk.trashed_at, now())
                        else null
                      end,
         tool       = excluded.tool,
         updated_at = now();
  return query
    select mk.message_id, mk.starred, mk.trashed_at
      from public.message_marks mk
     where mk.message_id = message and mk.member_id = caller;
end;
$$;

revoke execute on function public.set_message_mark(uuid, boolean, boolean, text) from public, anon;
grant execute on function public.set_message_mark(uuid, boolean, boolean, text) to authenticated;

notify pgrst, 'reload schema';
