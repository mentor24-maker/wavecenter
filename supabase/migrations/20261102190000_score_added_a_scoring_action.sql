-- "Added a scoring action" now earns its points (Dane, 2026-11-01: "1 point
-- per task is fine for now"). The sweep listed it
-- (20261102120000_scoring_actions_sweep.sql) but nothing recorded it, so it
-- showed "Not active yet". Core's side is addScoringRule in core/game.ts;
-- SCORING_TRIGGERS there names this function and its test.
--
-- What counts: a new rule saved through the Add form on Game > Manage
-- (add_scoring_rule). Rows a migration adds are not scored.
--
-- Credited to the admin who added it: changed_by, which add_scoring_rule
-- stamps from the signed-in member. Only when that is who is signed in now,
-- so a row written with the service key or by a migration (changed_by null)
-- is saved unscored rather than refused. Changing a rule is its own kind
-- (changed_a_scoring_rule), so only inserts fire this.
--
-- The engagement is written inside the same save as the rule, so if it
-- cannot be written the new action is not added either. No new table. Safe
-- to re-run.

create or replace function public.game_scoring_rules_score_added()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.changed_by is not null and new.changed_by = auth.uid() then
    perform public.record_engagement(new.changed_by, 'added_a_scoring_action', new.tool, null);
  end if;
  return null;
end;
$$;

drop trigger if exists game_scoring_rules_score_added on public.game_scoring_rules;
create trigger game_scoring_rules_score_added
  after insert on public.game_scoring_rules
  for each row
  execute function public.game_scoring_rules_score_added();

revoke execute on function public.game_scoring_rules_score_added() from public, anon, authenticated;

notify pgrst, 'reload schema';
