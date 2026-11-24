-- The game layer: giving a reason for a factor now earns its point. The
-- "Gave a reason for a factor" action was listed by the second sweep
-- (20261122140000_scoring_actions_sweep_2.sql, WC-188) but nothing recorded
-- it, so it showed "Not active yet" on Game > Manage. Each swept action is
-- wired by its own ticket (WC-198 for this one).
--
-- An action's four factor reasons (effort_reason, value_reason,
-- rarity_reason, farm_risk_reason; 20261103120000_scoring_factor_reasons.sql)
-- are saved only through set_scoring_factor_reasons
-- (20261103140000_edit_factor_reasons.sql; saveFactorReason in
-- app/game/manage/actions.ts), which stamps changed_by with the signed-in
-- admin. What counts: a saved change to any of the four, clearing one
-- included. A save that changes none of them is not scored. Changing a
-- rule's wording or points (changed_a_scoring_rule), its factors
-- (scored_an_action_s_factors) or adding an action (added_a_scoring_action)
-- has its own trigger; none of them is this.
--
-- Credited to changed_by only when that is who is signed in now, so a row
-- written with the service key (a migration, or a check putting a rule
-- back) is saved unscored rather than refused, and never credited to
-- whichever admin last touched it. Worth what the rule says at that moment,
-- naming the save's own tool. It runs inside the same save, so the reason
-- and its engagement land together or not at all; a refused save records
-- nothing. Only saves after this runs count; nothing is backfilled.
--
-- The rule gets its four factor scores and their reasons
-- (docs/GRANULAR_SCORING_ALGORITHM.md); its points stay as they are until an
-- admin puts the formula's value live from the Admin page, as for every
-- swept action. That fill runs with nobody signed in, so it scores nothing.
--
-- No new table. Safe to re-run.

create or replace function public.game_scoring_rules_score_reasons()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.changed_by is not null and new.changed_by = auth.uid() then
    perform public.record_engagement(new.changed_by, 'gave_a_reason_for_a_factor', new.tool, null);
  end if;
  return null;
end;
$$;

drop trigger if exists game_scoring_rules_score_reasons on public.game_scoring_rules;
create trigger game_scoring_rules_score_reasons
  after update of effort_reason, value_reason, rarity_reason, farm_risk_reason on public.game_scoring_rules
  for each row
  when ((old.effort_reason, old.value_reason, old.rarity_reason, old.farm_risk_reason) is distinct from (new.effort_reason, new.value_reason, new.rarity_reason, new.farm_risk_reason))
  execute function public.game_scoring_rules_score_reasons();

revoke execute on function public.game_scoring_rules_score_reasons() from public, anon, authenticated;

-- Its factors and reasons, as the document gives them. Only a row with none
-- yet is filled, so an admin's own scores are never overwritten.
update public.game_scoring_rules
   set effort = 1, value = 2, rarity = 1, farm_risk = 3,
       effort_reason = 'One sentence on why a factor got its score: under a minute.',
       value_reason = 'Every member can read on Game > Manage why an action is worth what it is.',
       rarity_reason = 'Reasons change a few times a week at most, and only an admin can write one.',
       farm_risk_reason = 'A reason can be changed straight back, so it loops.'
 where kind = 'gave_a_reason_for_a_factor'
   and effort is null and value is null and rarity is null and farm_risk is null;

notify pgrst, 'reload schema';
