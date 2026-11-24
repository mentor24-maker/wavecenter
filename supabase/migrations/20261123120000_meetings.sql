-- Meetings (Dane, 2026-11-22, WC-204, "Add a Meeting Manager to the Teams
-- page": "a dropdown selector for the team, a calendar table with clickable
-- dates to pop-up a meeting details page. In that page, include a field for
-- details about the venue (e.g. Zoom, Google Meet, etc.) and the ability to
-- invite members"). On the ticket he chose who plans them, "B": any member of
-- that team, inviting anyone.
--
-- Two new tables, each with row-level security on from the moment it is
-- made (engineering rule 2):
--
--   meetings         one meeting of one team, on one date at one time
--   meeting_invites  which member is invited to which meeting
--
-- Who may do what (core/meetings.ts says the same; the database repeats it so
-- a client that went around core still cannot break it):
--   * every role that may view teams (team.read) sees every meeting and who
--     is invited to it;
--   * a member of a meeting's team makes, changes and deletes its meetings,
--     and invites and uninvites members;
--   * anyone with a WaveCenter account may be invited.
-- An invitation is only recorded: nothing is sent. Nothing here is scored.
--
-- The date and start time are Mountain time wall-clock values, kept as typed
-- (no time zone), so a meeting at 10:00 shows at 10:00 on the date chosen.
--
-- Additive and safe to re-run: every create checks first.

create table if not exists public.meetings (
  id         uuid        primary key default gen_random_uuid(),
  -- Deleting a team takes its meetings with it.
  team_id    uuid        not null references public.teams (id) on delete cascade,
  title      text        not null check (length(btrim(title)) between 1 and 120),
  meets_on   date        not null,
  -- Mountain time, as typed.
  start_time time        not null,
  venue      text        check (venue is null or length(venue) <= 300),
  notes      text        check (notes is null or length(notes) <= 2000),
  tool       text        not null default 'wavecenter' check (length(btrim(tool)) > 0),
  created_by uuid        default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.meeting_invites (
  meeting_id uuid        not null references public.meetings (id) on delete cascade,
  -- Deleting a member's account takes their invitations with it.
  member_id  uuid        not null references auth.users (id) on delete cascade,
  tool       text        not null default 'wavecenter' check (length(btrim(tool)) > 0),
  invited_by uuid        default auth.uid() references auth.users (id) on delete set null,
  invited_at timestamptz not null default now(),
  primary key (meeting_id, member_id)
);

-- Row-level security in the same step that makes the tables (engineering rule 2).
alter table public.meetings        enable row level security;
alter table public.meeting_invites enable row level security;

create index if not exists meetings_team_day on public.meetings (team_id, meets_on);
create index if not exists meeting_invites_member_id on public.meeting_invites (member_id);

-- Is the signed-in member on this team? In the private schema, which the API
-- does not expose, like private.may. Security definer so the answer never
-- depends on who may read team_members.
create or replace function private.on_team(team uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.team_members tm where tm.team_id = on_team.team and tm.member_id = auth.uid()
  );
$$;

-- Is the signed-in member on the team that holds this meeting?
create or replace function private.on_meeting_team(meeting uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.meetings m where m.id = on_meeting_team.meeting and private.on_team(m.team_id)
  );
$$;

revoke execute on function private.on_team(uuid) from public, anon;
revoke execute on function private.on_meeting_team(uuid) from public, anon;
grant execute on function private.on_team(uuid) to authenticated;
grant execute on function private.on_meeting_team(uuid) to authenticated;

-- Start from no rights at all and grant only what is used. A meeting never
-- moves to another team (no update on team_id); who made it and when are the
-- database's.
revoke all on public.meetings, public.meeting_invites from anon, authenticated;

grant select on public.meetings to authenticated;
grant insert (team_id, title, meets_on, start_time, venue, notes, tool) on public.meetings to authenticated;
grant update (title, meets_on, start_time, venue, notes, tool) on public.meetings to authenticated;
grant delete on public.meetings to authenticated;

grant select on public.meeting_invites to authenticated;
grant insert (meeting_id, member_id, tool) on public.meeting_invites to authenticated;
grant delete on public.meeting_invites to authenticated;

drop policy if exists "meetings: view teams can read"                on public.meetings;
drop policy if exists "meetings: a team's members add"               on public.meetings;
drop policy if exists "meetings: a team's members change"            on public.meetings;
drop policy if exists "meetings: a team's members delete"            on public.meetings;
drop policy if exists "meeting_invites: view teams can read"         on public.meeting_invites;
drop policy if exists "meeting_invites: a team's members invite"     on public.meeting_invites;
drop policy if exists "meeting_invites: a team's members uninvite"   on public.meeting_invites;

create policy "meetings: view teams can read" on public.meetings
  for select to authenticated using ((select private.may('team.read')));
create policy "meetings: a team's members add" on public.meetings
  for insert to authenticated with check (private.on_team(team_id));
create policy "meetings: a team's members change" on public.meetings
  for update to authenticated using (private.on_team(team_id)) with check (private.on_team(team_id));
create policy "meetings: a team's members delete" on public.meetings
  for delete to authenticated using (private.on_team(team_id));

create policy "meeting_invites: view teams can read" on public.meeting_invites
  for select to authenticated using ((select private.may('team.read')));
create policy "meeting_invites: a team's members invite" on public.meeting_invites
  for insert to authenticated with check (private.on_meeting_team(meeting_id));
create policy "meeting_invites: a team's members uninvite" on public.meeting_invites
  for delete to authenticated using (private.on_meeting_team(meeting_id));

-- Keep updated_at current, and stamp who made a meeting and who invited a
-- member: never what the browser sent.
create or replace function public.meetings_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists meetings_touch on public.meetings;
create trigger meetings_touch before insert or update on public.meetings
  for each row execute function public.meetings_touch();

create or replace function public.meeting_invites_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.invited_by := auth.uid();
  new.invited_at := now();
  return new;
end;
$$;

drop trigger if exists meeting_invites_stamp on public.meeting_invites;
create trigger meeting_invites_stamp before insert on public.meeting_invites
  for each row execute function public.meeting_invites_stamp();

notify pgrst, 'reload schema';
