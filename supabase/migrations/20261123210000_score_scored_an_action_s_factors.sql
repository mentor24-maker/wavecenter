-- The game layer: scoring an action's factors now earns its point. The
-- "Scored an action's factors" action was listed by the second sweep
-- (20261122140000_scoring_actions_sweep_2.sql, WC-188) but nothing recorded
-- it, so it showed "Not active yet" on Game > Manage. Each swept action is
-- wired by its own ticket (WC-197 for this one).
--
-- An action's four factors (effort, value, rarity, farm_risk) are saved only
-- through set_scoring_factors (20261102180000_scoring_factors.sql;
-- saveScoringFactors in app/game/manage/actions.ts), which stamps changed_by
-- with the signed-in admin. What counts: a saved change to any of the four,
-- clearing them included. A save that changes none of them is not scored.
-- Changing a rule's wording or points is changed_a_scoring_rule's own
-- trigger (game_scoring_rules_score), and adding an action is
-- added_a_scoring_action's; neither is this.
--
-- Credited to changed_by only when that is who is signed in now, so a row
-- written with the service key (a migration, or a check putting a rule
-- back) is saved unscored rather than refused, and never credited to
-- whichever admin last touched it. Worth what the rule says at that moment,
-- naming the save's own tool. It runs inside the same save, so the factors
-- and their engagement land together or not at all; a refused save records
-- nothing. Only saves after this runs count; nothing is backfilled.
--
-- The rule gets its four factor scores and their reasons
-- (docs/GRANULAR_SCORING_ALGORITHM.md); its points stay as they are until an
-- admin puts the formula's value live from the Admin page, as for every
-- swept action. That fill runs with nobody signed in, so it scores nothing.
--
-- No new table. Safe to re-run.

create or replace function public.game_scoring_rules_score_factors()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.changed_by is not null and new.changed_by = auth.uid() then
    perform public.record_engagement(new.changed_by, 'scored_an_action_s_factors', new.tool, null);
  end if;
  return null;
end;
$$;

drop trigger if exists game_scoring_rules_score_factors on public.game_scoring_rules;
create trigger game_scoring_rules_score_factors
  after update of effort, value, rarity, farm_risk on public.game_scoring_rules
  for each row
  when ((old.effort, old.value, old.rarity, old.farm_risk) is distinct from (new.effort, new.value, new.rarity, new.farm_risk))
  execute function public.game_scoring_rules_score_factors();

revoke execute on function public.game_scoring_rules_score_factors() from public, anon, authenticated;

-- Its factors and reasons, as the document gives them. Only a row with none
-- yet is filled, so an admin's own scores are never overwritten.
update public.game_scoring_rules
   set effort = 1, value = 2, rarity = 1, farm_risk = 3,
       effort_reason = 'Weighing an action and picking its four scores: about a minute.',
       value_reason = 'Sets what the batch proposes each action be worth, which every member earns by.',
       rarity_reason = 'Factors change a few times a week at most, and only an admin can change them.',
       farm_risk_reason = 'Factors can be changed straight back, so it loops.'
 where kind = 'scored_an_action_s_factors'
   and effort is null and value is null and rarity is null and farm_risk is null;

notify pgrst, 'reload schema';
