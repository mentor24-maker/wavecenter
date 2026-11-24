-- The game layer: changing a token size now earns its point. The "Changed a
-- token size" action was listed by the second sweep
-- (20261122140000_scoring_actions_sweep_2.sql, WC-188) but nothing recorded
-- it, so it showed "Not active yet" on Game > Manage. Each swept action is
-- wired by its own ticket (WC-200 for this one).
--
-- A token size is changed on Game > Manage (saveTokenSize with an id in
-- app/game/manage/actions.ts, changeTokenSize in core/tokens.ts), which
-- updates one row of token_sizes (20261103150000_token_settings.sql). Its
-- token_sizes_stamp trigger stamps updated_by with the signed-in member
-- before the row is written. What counts: a saved change to a token size's
-- name, size, colour or point level. A save that changes none of those (the
-- form sent back as it was) is not counted. Adding a size and removing one
-- are their own actions (each has its own ticket); neither is this.
--
-- Credited to updated_by only when that is who is signed in now, so a row
-- written with the service key (a migration, or a check putting sizes back)
-- is saved unscored rather than refused. Worth what the rule says at that
-- moment, naming the row's own tool. It runs inside the same update, so the
-- change and its engagement land together or not at all; a refused or failed
-- save records nothing. Only changes made after this runs count; nothing is
-- backfilled.
--
-- The rule gets its four factor scores and their reasons
-- (docs/GRANULAR_SCORING_ALGORITHM.md); its points stay as they are until an
-- admin puts the formula's value live from the Admin page, as for every
-- swept action. That fill runs with nobody signed in, so it scores nothing.
--
-- No new table. Safe to re-run.

create or replace function public.token_sizes_score_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.updated_by is not null and new.updated_by = auth.uid() then
    perform public.record_engagement(new.updated_by, 'changed_a_token_size', new.tool, null);
  end if;
  return null;
end;
$$;

drop trigger if exists token_sizes_score_changed on public.token_sizes;
create trigger token_sizes_score_changed
  after update of name, diameter, color, min_points on public.token_sizes
  for each row
  when ((old.name, old.diameter, old.color, old.min_points) is distinct from (new.name, new.diameter, new.color, new.min_points))
  execute function public.token_sizes_score_changed();

revoke execute on function public.token_sizes_score_changed() from public, anon, authenticated;

-- Its factors and reasons, as the document gives them. Only a row with none
-- yet is filled, so an admin's own scores are never overwritten.
update public.game_scoring_rules
   set effort = 1, value = 2, rarity = 1, farm_risk = 3,
       effort_reason = 'The same short form as adding one, already filled in: under a minute.',
       value_reason = 'Every member''s earned-points tokens are drawn from the sizes.',
       rarity_reason = 'Only an admin can change a size, but they can tune one many times while setting up.',
       farm_risk_reason = 'A size can be changed and changed straight back, so it loops.'
 where kind = 'changed_a_token_size'
   and effort is null and value is null and rarity is null and farm_risk is null;

notify pgrst, 'reload schema';
