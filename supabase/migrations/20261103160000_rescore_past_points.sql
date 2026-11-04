-- Rescoring past points while scoring is provisional (Dane, 2026-11-03:
-- "I'd like to have the ability to retroactively readjust during the
-- development phase when you aren't sure how many points anything is
-- worth"). An admin brings every member's past points for an action to what
-- the action is worth today, from the Admin page.
--
-- The ledger is never rewritten. A rescore ADDS correction rows: for each
-- member and action whose credit changes, one engagements row of the same
-- kind whose points are the difference (it may be negative), with the tool
-- 'rescore' and the rescore's id. A member's total stays a plain sum.
--
-- What an action should have credited a member = the times they really did
-- it (rows with no rescore_id) x its points today. The correction is that
-- minus everything already credited for it, earlier corrections included,
-- so running it twice in a row changes nothing. core/game.ts
-- (rescoreCorrections, applyRescore) holds the same rule and its tests.
--
-- New:
--   game_settings  one row; scoring_provisional, true until the DEO's points
--                  are declared final (that switch is its own ticket, "Admins
--                  cannot declare a DEO's points final")
--   rescores       one row per rescore that changed something
--   engagements.rescore_id  set only on a correction row
--   rescore_tallies()       the preview's figures, admins only
--   apply_rescore()         the rescore itself, admins only, provisional only
--
-- Additive only: no existing row changes. Safe to re-run.

-- One row, always: the DEO's game settings.
create table if not exists public.game_settings (
  id                  boolean     primary key default true check (id),
  scoring_provisional boolean     not null default true,
  updated_at          timestamptz not null default now()
);

-- Engineering rule 2: row-level security is on from the moment the table
-- exists. Every member may read it. Nobody writes it through the API yet:
-- only game.edit may, and the one change it will allow (ending the
-- provisional phase, for good) comes with the switch's own ticket.
alter table public.game_settings enable row level security;

revoke all on public.game_settings from anon, authenticated;
grant select on public.game_settings to authenticated;

drop policy if exists "game_settings: members can read" on public.game_settings;
create policy "game_settings: members can read" on public.game_settings
  for select to authenticated using (true);

insert into public.game_settings (id) values (true) on conflict (id) do nothing;

-- One row per rescore that saved: who ran it, when, with which tool, and
-- how many correction rows and points (net) it added.
create table if not exists public.rescores (
  id             uuid        primary key default gen_random_uuid(),
  run_by         uuid        references auth.users (id) on delete set null,
  tool           text        not null check (length(btrim(tool)) > 0),
  rows_changed   integer     not null check (rows_changed >= 0),
  points_changed integer     not null,
  created_at     timestamptz not null default now()
);

-- Engineering rule 2 again. Only game.edit reads the history; only
-- apply_rescore writes it.
alter table public.rescores enable row level security;

revoke all on public.rescores from anon, authenticated;
grant select on public.rescores to authenticated;

drop policy if exists "rescores: manage game scoring can read" on public.rescores;
create policy "rescores: manage game scoring can read" on public.rescores
  for select to authenticated using ((select private.may('game.edit')));

-- A correction row names its rescore; every real action leaves it null.
alter table public.engagements add column if not exists rescore_id uuid references public.rescores (id);

-- The total still adds up every row; the count is of real actions only.
create or replace view public.engagement_totals
with (security_invoker = true) as
  select member_id, sum(points)::bigint as points, count(*) filter (where rescore_id is null)::bigint as engagements
  from public.engagements
  group by member_id;

-- The preview: every member's ledger added up per action, with their name
-- if their profile is public (as the members list shows it). Admins only;
-- it reads past row-level security, which keeps each member to their own.
create or replace function public.rescore_tallies()
returns table (member_id uuid, member_name text, kind text, actions bigint, credited bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.may('game.edit') then
    raise exception 'Only an admin can rescore past points.' using errcode = '42501';
  end if;
  return query
    select e.member_id,
           max(case when p.visibility = 'public' then p.display_name end),
           e.kind,
           count(*) filter (where e.rescore_id is null),
           sum(e.points)::bigint
      from public.engagements e
      left join public.member_profiles p on p.owner_id = e.member_id
     group by e.member_id, e.kind;
end;
$$;

revoke execute on function public.rescore_tallies() from public, anon;
grant execute on function public.rescore_tallies() to authenticated;

-- The rescore: add the correction rows for the given actions, all in this
-- one transaction. Refuses anyone without game.edit, and refuses once
-- scoring is no longer provisional. The settings row is locked first, so
-- two rescores (or a rescore and the end of the provisional phase) never
-- run at once. Nothing to change saves nothing and returns 0 rows.
create or replace function public.apply_rescore(rescore_kinds text[], tool text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := private.require_game_edit(tool);
  v_provisional boolean;
  v_id uuid;
  v_rows integer;
  v_points integer;
begin
  if rescore_kinds is null or cardinality(rescore_kinds) = 0 then
    raise exception 'Tick at least one action to rescore. Nothing was saved.' using errcode = '22023';
  end if;
  select s.scoring_provisional into v_provisional from public.game_settings s where s.id for update;
  if not coalesce(v_provisional, false) then
    raise exception 'Points are final for this DEO, so past points can no longer be rescored. Nothing was saved.' using errcode = '42501';
  end if;

  insert into public.rescores (run_by, tool, rows_changed, points_changed)
  values (caller, btrim(tool), 0, 0)
  returning id into v_id;

  with corrections as (
    select e.member_id, e.kind,
           (count(*) filter (where e.rescore_id is null) * r.points - sum(e.points))::integer as difference
      from public.engagements e
      join public.game_scoring_rules r on r.kind = e.kind
     where e.kind = any (rescore_kinds)
     group by e.member_id, e.kind, r.points
  ), added as (
    insert into public.engagements (member_id, kind, points, tool, task_id, rescore_id)
    select c.member_id, c.kind, c.difference, 'rescore', null, v_id
      from corrections c
     where c.difference <> 0
    returning points
  )
  select count(*)::integer, coalesce(sum(a.points), 0)::integer into v_rows, v_points from added a;

  if v_rows = 0 then
    delete from public.rescores where id = v_id;
    return json_build_object('rescore_id', null, 'rows', 0, 'points', 0);
  end if;
  update public.rescores set rows_changed = v_rows, points_changed = v_points where id = v_id;
  return json_build_object('rescore_id', v_id, 'rows', v_rows, 'points', v_points);
end;
$$;

revoke execute on function public.apply_rescore(text[], text) from public, anon;
grant execute on function public.apply_rescore(text[], text) to authenticated;

notify pgrst, 'reload schema';
