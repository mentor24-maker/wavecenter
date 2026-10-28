-- Member profiles (Dane, 2026-10-27, from the WaveCenter task "User profile
-- management page, with privacy settings based on the article at
-- https://wavecenter.com/privacy-and-security-first/"; he chose the first
-- slice: display name, a built-in avatar, a short bio and one visibility
-- choice). Every profile starts completely anonymous. The rules live in
-- core/profiles.ts; the checks below repeat them so a change that went around
-- core still cannot store something core would refuse. Plain-words
-- explanation: docs/DATA_MODEL.md.
--
-- Additive only. Safe to re-run: every statement checks before it creates.

create table if not exists public.member_profiles (
  owner_id     uuid        primary key default auth.uid()
                           references auth.users (id) on delete cascade,
  display_name text        check (display_name is null
                                  or (length(btrim(display_name)) > 0 and char_length(display_name) <= 50)),
  avatar       text        not null default 'wave'
                           check (avatar in ('wave', 'sun', 'moon', 'star', 'leaf', 'mountain', 'flame', 'shell')),
  bio          text        check (bio is null
                                  or (length(btrim(bio)) > 0 and char_length(bio) <= 280)),
  visibility   text        not null default 'anonymous'
                           check (visibility in ('anonymous', 'private', 'public')),
  tool         text        not null default 'wavecenter'
                           check (length(btrim(tool)) > 0),
  updated_at   timestamptz not null default now()
);

-- Engineering rule 2: row-level security is on from the moment the table
-- exists. A member reads and writes only their own row; signed-out visitors
-- get nothing. There is no screen yet that shows one member's profile to
-- another, so no policy lets anyone else read it, whatever its visibility.
-- Start from no rights at all and grant only what is used.
alter table public.member_profiles enable row level security;

revoke all on public.member_profiles from anon, authenticated;
grant select, insert, update on public.member_profiles to authenticated;

drop policy if exists "member_profiles: owner can read"   on public.member_profiles;
drop policy if exists "member_profiles: owner can insert" on public.member_profiles;
drop policy if exists "member_profiles: owner can update" on public.member_profiles;

create policy "member_profiles: owner can read" on public.member_profiles
  for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy "member_profiles: owner can insert" on public.member_profiles
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "member_profiles: owner can update" on public.member_profiles
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create or replace function public.member_profiles_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists member_profiles_touch on public.member_profiles;
create trigger member_profiles_touch
  before insert or update on public.member_profiles
  for each row execute function public.member_profiles_touch();

-- The game layer: every profile save is an engagement ("nothing happens
-- within WaveCenter that isn't tracked and scored"). Placeholder value, kept
-- in step with STARTING_SCORING_RULES in core/game.ts (a test compares them).
insert into public.game_scoring_rules (kind, name, description, criteria, points, position) values
  ('changed_profile',  'Changed your profile',         'Saved your name, avatar, bio or who can see them.',                     'Your profile is saved.',                                                       1, 9)
on conflict (kind) do nothing;

create or replace function public.member_profiles_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.record_engagement(new.owner_id, 'changed_profile', new.tool, null);
  return null;
end;
$$;

drop trigger if exists member_profiles_score on public.member_profiles;
create trigger member_profiles_score
  after insert or update on public.member_profiles
  for each row execute function public.member_profiles_score();

revoke execute on function public.member_profiles_score() from public, anon, authenticated;

notify pgrst, 'reload schema';
