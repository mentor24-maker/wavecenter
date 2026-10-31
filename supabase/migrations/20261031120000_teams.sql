-- Teams (Dane, 2026-10-30, from the WaveCenter task "Create a Team Manager
-- page": "a CRUD table for all existing Teams. Teams include the Team name,
-- slug, description … The members of any given team are associated with it,
-- so they can be listed as members of the team, subject to their own privacy
-- settings"). On 2026-10-30 he chose who manages them, "B": admins and
-- editors. Two new tables and two new permissions:
--
--   team.read  View teams    every role
--   team.edit  Manage teams  admin and editor
--
-- The rules live in core/teams.ts and core/members.ts (PERMISSIONS,
-- STARTING_ROLE_PERMISSIONS); a test keeps this file in step with them. The
-- row-level security below repeats who may do what, so a client that went
-- around core still cannot break it. Plain-words explanation:
-- docs/DATA_MODEL.md.
--
-- Additive only. Safe to re-run: every statement checks before it creates.

insert into public.permissions (key, label, position) values
  ('team.read', 'View teams',   7),
  ('team.edit', 'Manage teams', 8)
on conflict (key) do nothing;

insert into public.role_permissions (role, permission) values
  ('admin',       'team.read'), ('admin',  'team.edit'),
  ('editor',      'team.read'), ('editor', 'team.edit'),
  ('contributor', 'team.read'),
  ('reviewer',    'team.read'),
  ('viewer',      'team.read')
on conflict do nothing;

-- Does the signed-in member's role have the permission? In the private
-- schema, which the API does not expose, like private.member_role.
create or replace function private.may(permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.role_permissions rp
     where rp.role = private.member_role(auth.uid()) and rp.permission = may.permission
  );
$$;

revoke execute on function private.may(text) from public, anon;
grant execute on function private.may(text) to authenticated;

-- One row is one team. The slug is the team's short web-address name:
-- lowercase letters, digits and single hyphens, unique across WaveCenter.
create table if not exists public.teams (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null check (length(btrim(name)) between 1 and 80),
  slug        text        not null unique check (length(slug) <= 60 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text        check (description is null or length(description) <= 500),
  tool        text        not null default 'wavecenter' check (length(btrim(tool)) > 0),
  created_by  uuid        default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Which member is on which team. Deleting a team or a member account takes
-- its links with it; deleting a team never touches a member account.
create table if not exists public.team_members (
  team_id   uuid        not null references public.teams (id) on delete cascade,
  member_id uuid        not null references auth.users (id) on delete cascade,
  tool      text        not null default 'wavecenter' check (length(btrim(tool)) > 0),
  added_by  uuid        default auth.uid() references auth.users (id) on delete set null,
  added_at  timestamptz not null default now(),
  primary key (team_id, member_id)
);

create index if not exists team_members_member_id on public.team_members (member_id);

-- Engineering rule 2: row-level security is on from the moment each table
-- exists. Start from no rights at all and grant only what is used.
alter table public.teams        enable row level security;
alter table public.team_members enable row level security;

revoke all on public.teams, public.team_members from anon, authenticated;

-- A member may only write the fields a screen sets; the id, who made it and
-- when are the database's.
grant select on public.teams to authenticated;
grant insert (name, slug, description, tool) on public.teams to authenticated;
grant update (name, slug, description, tool) on public.teams to authenticated;
grant delete on public.teams to authenticated;

grant select on public.team_members to authenticated;
grant insert (team_id, member_id, tool) on public.team_members to authenticated;
grant delete on public.team_members to authenticated;

drop policy if exists "teams: view teams can read"           on public.teams;
drop policy if exists "teams: manage teams can add"          on public.teams;
drop policy if exists "teams: manage teams can change"       on public.teams;
drop policy if exists "teams: manage teams can delete"       on public.teams;
drop policy if exists "team_members: view teams can read"    on public.team_members;
drop policy if exists "team_members: manage teams can add"   on public.team_members;
drop policy if exists "team_members: manage teams can remove" on public.team_members;

-- The inner selects make Postgres work out the caller's permission once per
-- query, not once per row.
create policy "teams: view teams can read" on public.teams
  for select to authenticated using ((select private.may('team.read')));
create policy "teams: manage teams can add" on public.teams
  for insert to authenticated with check ((select private.may('team.edit')));
create policy "teams: manage teams can change" on public.teams
  for update to authenticated using ((select private.may('team.edit'))) with check ((select private.may('team.edit')));
create policy "teams: manage teams can delete" on public.teams
  for delete to authenticated using ((select private.may('team.edit')));

create policy "team_members: view teams can read" on public.team_members
  for select to authenticated using ((select private.may('team.read')));
create policy "team_members: manage teams can add" on public.team_members
  for insert to authenticated with check ((select private.may('team.edit')));
create policy "team_members: manage teams can remove" on public.team_members
  for delete to authenticated using ((select private.may('team.edit')));

-- Keep updated_at current, and stamp who made a team: never what the
-- browser sent.
create or replace function public.teams_touch()
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

drop trigger if exists teams_touch on public.teams;
create trigger teams_touch before insert or update on public.teams
  for each row execute function public.teams_touch();

create or replace function public.team_members_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.added_by := auth.uid();
  new.added_at := now();
  return new;
end;
$$;

drop trigger if exists team_members_stamp on public.team_members;
create trigger team_members_stamp before insert on public.team_members
  for each row execute function public.team_members_stamp();

-- Every team's members, for the Team Manager page: any role with team.read.
-- As list_members does, it shows each member only as their profile lets other
-- members see them: their avatar unless their profile is private, and their
-- name only if it is public. No email address ever leaves this function.
create or replace function public.list_team_members()
returns table (team_id uuid, member_id uuid, avatar text, display_name text, added_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.may('team.read') then
    raise exception 'Your role may not see the teams.' using errcode = '42501';
  end if;
  return query
    select tm.team_id,
           tm.member_id,
           case when coalesce(p.visibility, 'anonymous') = 'private' then null else coalesce(p.avatar, 'wave') end,
           case when p.visibility = 'public' then p.display_name else null end,
           tm.added_at
      from public.team_members tm
      left join public.member_profiles p on p.owner_id = tm.member_id
     order by tm.added_at;
end;
$$;

revoke execute on function public.list_team_members() from public, anon;
grant execute on function public.list_team_members() to authenticated;

notify pgrst, 'reload schema';
