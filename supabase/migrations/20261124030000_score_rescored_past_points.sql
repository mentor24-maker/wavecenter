-- "Rescored past points" earns its point (WC-202). The second sweep
-- (20261122140000_scoring_actions_sweep_2.sql) listed it on Game > Manage
-- at 1 point, "Not active yet". This wires it: each rescore that saves
-- records one rescored_past_points engagement for the admin who ran it,
-- through the ledger's own write function (public.record_engagement),
-- naming the rescore's tool.
--
-- Why the update, not the insert: apply_rescore
-- (20261103160000_rescore_past_points.sql) inserts its rescores row first,
-- with rows_changed 0, then works the corrections out, then either deletes
-- the row (nothing needed to change: nothing saved, nothing earned) or sets
-- rows_changed to the number of correction rows it added. That update is the
-- moment a rescore is saved, so this trigger fires on it:
--   - a rescore that changes nothing is never updated, so it earns nothing;
--   - the corrections are already written when it fires, so the point is
--     never rescored by the same run that earned it;
--   - record_engagement writes no rescore_id, so the point is a real action,
--     never a correction row.
-- It credits the member who ran it only when they are the one signed in
-- (run_by = auth.uid()), so a service-key write (nobody signed in) is
-- skipped rather than failing the save. If the engagement cannot be written,
-- the whole rescore rolls back with it: one transaction.
--
-- Its four factors and reasons are the ones docs/GRANULAR_SCORING_ALGORITHM.md
-- gives it; its points stay at 1 until an admin puts the formula's value live.
--
-- Additive only. Safe to re-run.

create or replace function public.rescores_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid := auth.uid();
begin
  if v_member is not null and new.run_by = v_member then
    perform public.record_engagement(v_member, 'rescored_past_points', new.tool, null);
  end if;
  return null;
end;
$$;

revoke execute on function public.rescores_score() from public, anon, authenticated;

drop trigger if exists rescores_score on public.rescores;
create trigger rescores_score
  after update of rows_changed on public.rescores
  for each row
  when (old.rows_changed = 0 and new.rows_changed > 0)
  execute function public.rescores_score();

update public.game_scoring_rules
   set effort = 1, value = 2, rarity = 2, farm_risk = 2,
       effort_reason = 'Reading the preview and ticking the actions to rescore: under a minute.',
       value_reason = 'Every member''s total is brought in line with the values they now earn by.',
       rarity_reason = 'Only an admin can rescore, only while scoring is provisional: a handful of times ever.',
       farm_risk_reason = 'A rescore that changes nothing earns nothing, but an admin can change a rule''s points and rescore again in seconds.'
 where kind = 'rescored_past_points'
   and effort is null and value is null and rarity is null and farm_risk is null;

notify pgrst, 'reload schema';
