-- "Changed a scoring rule" now earns its points (Dane, 2026-11-01: "1 point
-- per task is fine for now"). The sweep listed it
-- (20261102120000_scoring_actions_sweep.sql) but nothing recorded it, so it
-- showed "Not active yet". Core's side is changeScoringRule in core/game.ts;
-- SCORING_TRIGGERS there names this function and its test.
--
-- What counts: a saved change to a rule's name, description, criteria or
-- points. A save that changes none of them is not scored.
--
-- Credited to the admin who changed it: changed_by, which
-- update_scoring_rule stamps from the signed-in member. Only when that is who
-- is signed in now, so a row written with the service key (a migration, or a
-- check putting a rule back) is saved unscored rather than refused, and never
-- credited to whichever admin last touched it. Adding a new action is its own
-- kind (added_a_scoring_action), so only updates fire this.
--
-- The engagement is written inside the same save as the rule, so if it
-- cannot be written the rule does not change either. No new table. Safe to
-- re-run.

create or replace function public.game_scoring_rules_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.changed_by is not null and new.changed_by = auth.uid() then
    perform public.record_engagement(new.changed_by, 'changed_a_scoring_rule', new.tool, null);
  end if;
  return null;
end;
$$;

drop trigger if exists game_scoring_rules_score on public.game_scoring_rules;
create trigger game_scoring_rules_score
  after update on public.game_scoring_rules
  for each row
  when ((old.name, old.description, old.criteria, old.points) is distinct from (new.name, new.description, new.criteria, new.points))
  execute function public.game_scoring_rules_score();

revoke execute on function public.game_scoring_rules_score() from public, anon, authenticated;

notify pgrst, 'reload schema';
