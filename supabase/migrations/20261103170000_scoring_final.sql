-- Making a DEO's points final (Dane, 2026-11-03, asked whether ending the
-- provisional phase should be permanent: "Permanent (Recommended)"). Once an
-- admin declares the points final, nobody can rescore history again, so
-- members can trust that points they have earned stay earned.
--
-- The permanence lives here, not only on the screen: a trigger refuses any
-- change that sets scoring_provisional back to true, and refuses deleting
-- the settings row once points are final (a fresh row would start
-- provisional). Reopening the provisional phase, if it is ever needed, is a
-- migration an agent session writes on Dane's written word; the app has no
-- way to do it.
--
-- New:
--   game_settings.scoring_final_at  when points were made final
--   game_settings.scoring_final_by  who made them final
--   make_scoring_final()            the switch, game.edit only, once
--   scoring_phase()                 the phase, with the name of who ended
--                                   it if their profile is public; every member
--
-- Additive only: no existing row changes. Safe to re-run.

alter table public.game_settings add column if not exists scoring_final_at timestamptz;
alter table public.game_settings add column if not exists scoring_final_by uuid references auth.users (id) on delete set null;

-- One way only. Final stays final, and keeps the date and the admin it was
-- given; provisional carries no final date. Every write is stamped.
create or replace function private.game_settings_stay_final()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if not old.scoring_provisional then
      raise exception 'Points are final for this DEO, and that cannot be undone. Nothing was saved.' using errcode = '42501';
    end if;
    return old;
  end if;
  if not old.scoring_provisional and new.scoring_provisional then
    raise exception 'Points are final for this DEO, and that cannot be undone. Nothing was saved.' using errcode = '42501';
  end if;
  if not old.scoring_provisional then
    new.scoring_final_at := old.scoring_final_at;
    new.scoring_final_by := old.scoring_final_by;
  elsif new.scoring_provisional then
    new.scoring_final_at := null;
    new.scoring_final_by := null;
  else
    new.scoring_final_at := coalesce(new.scoring_final_at, now());
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists game_settings_stay_final on public.game_settings;
create trigger game_settings_stay_final
  before update or delete on public.game_settings
  for each row execute function private.game_settings_stay_final();

-- The phase for every member: provisional or final, since when, and who
-- made it final, by their name only if their profile is public (as the
-- members list shows it). It reads past member_profiles' row-level security,
-- which keeps each member to their own profile, for that one name.
create or replace function public.scoring_phase()
returns table (provisional boolean, final_at timestamptz, final_by uuid, final_by_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.scoring_provisional, s.scoring_final_at, s.scoring_final_by,
         case when p.visibility = 'public' then p.display_name end
    from public.game_settings s
    left join public.member_profiles p on p.owner_id = s.scoring_final_by
   where s.id and auth.uid() is not null;
$$;

revoke execute on function public.scoring_phase() from public, anon;
grant execute on function public.scoring_phase() to authenticated;

-- The switch: game.edit only, and only once. The settings row is locked
-- first, as apply_rescore locks it, so a rescore and the end of the
-- provisional phase never run at once.
create or replace function public.make_scoring_final(tool text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := private.require_game_edit(tool);
  v_provisional boolean;
  v_at timestamptz;
begin
  select s.scoring_provisional into v_provisional from public.game_settings s where s.id for update;
  if not found then
    raise exception 'The game settings are missing, so WaveCenter cannot tell whether points are final. Nothing was saved.' using errcode = 'P0002';
  end if;
  if not v_provisional then
    raise exception 'Points are already final for this DEO. That cannot be undone, and nothing was changed.' using errcode = '42501';
  end if;
  update public.game_settings
     set scoring_provisional = false, scoring_final_at = now(), scoring_final_by = caller
   where id
  returning scoring_final_at into v_at;
  return json_build_object('provisional', false, 'final_at', v_at, 'final_by', caller);
end;
$$;

revoke execute on function public.make_scoring_final(text) from public, anon;
grant execute on function public.make_scoring_final(text) to authenticated;

notify pgrst, 'reload schema';
