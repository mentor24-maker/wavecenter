-- "Made points final" earns its point (WC-203). The second sweep
-- (20261122140000_scoring_actions_sweep_2.sql) listed it on Game > Manage
-- at 1 point, "Not active yet". This wires it: the moment an admin makes
-- points final (make_scoring_final, 20261103170000_scoring_final.sql), one
-- made_points_final engagement is recorded for that admin, through the
-- ledger's own write function (public.record_engagement).
--
-- Why this trigger fires when it does: make_scoring_final ends the
-- provisional phase with one update of game_settings, setting
-- scoring_provisional to false and scoring_final_by to the admin. The
-- game_settings_stay_final trigger refuses ever setting it back, so that
-- change from provisional to final can happen only once per DEO, and this
-- trigger fires only on it:
--   - a second try is refused before any update, so it earns nothing;
--   - deleting the admin's account later clears scoring_final_by (an update
--     that leaves scoring_provisional alone), which does not fire it.
-- It credits the admin only when they are the one signed in
-- (scoring_final_by = auth.uid()), so a service-key write (nobody signed
-- in) is skipped rather than failing the save. If the engagement cannot be
-- written, making points final rolls back with it: one transaction.
--
-- game_settings has no tool column, so the tool comes from the request's
-- x-wavecenter-tool header (app/lib/engagementStore.ts sends it), as for
-- other tables without one.
--
-- Its four factors and reasons are the ones docs/GRANULAR_SCORING_ALGORITHM.md
-- gives it; its points stay at 1 until an admin puts the formula's value live.
--
-- Additive only. Safe to re-run.

create or replace function public.game_settings_score_final()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid := auth.uid();
begin
  if v_member is not null and new.scoring_final_by = v_member then
    perform public.record_engagement(v_member, 'made_points_final', public.engagement_tool('supabase-api'), null);
  end if;
  return null;
end;
$$;

revoke execute on function public.game_settings_score_final() from public, anon, authenticated;

drop trigger if exists game_settings_score_final on public.game_settings;
create trigger game_settings_score_final
  after update of scoring_provisional on public.game_settings
  for each row
  when (old.scoring_provisional and not new.scoring_provisional)
  execute function public.game_settings_score_final();

update public.game_scoring_rules
   set effort = 1, value = 2, rarity = 2, farm_risk = 0,
       effort_reason = 'Reading the warning and typing FINAL to confirm: under a minute.',
       value_reason = 'From then on every member can rely on the points they have earned staying earned.',
       rarity_reason = 'It can happen only once in a DEO''s life, and only an admin can do it.',
       farm_risk_reason = 'It cannot be repeated or undone, so it can never be farmed.'
 where kind = 'made_points_final'
   and effort is null and value is null and rarity is null and farm_risk is null;

notify pgrst, 'reload schema';
