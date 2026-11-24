-- The game layer: adding a token size now earns its point. The "Added a
-- token size" action was listed by the second sweep
-- (20261122140000_scoring_actions_sweep_2.sql, WC-188) but nothing recorded
-- it, so it showed "Not active yet" on Game > Manage. Each swept action is
-- wired by its own ticket (WC-199 for this one).
--
-- A token size is added on Game > Manage (saveTokenSize with no id in
-- app/game/manage/actions.ts, addTokenSize in core/tokens.ts), which inserts
-- one row into token_sizes (20261103150000_token_settings.sql). Its
-- token_sizes_stamp trigger stamps updated_by with the signed-in member
-- before the row is written. What counts: a new token size is saved.
-- Changing a size and removing one are their own actions (each has its own
-- ticket); neither is this.
--
-- Credited to updated_by only when that is who is signed in now, so a row
-- written with the service key (a migration, or a check putting sizes back)
-- is saved unscored rather than refused. Worth what the rule says at that
-- moment, naming the row's own tool. It runs inside the same insert, so the
-- size and its engagement land together or not at all; a refused or failed
-- save records nothing. Only sizes added after this runs count; the three
-- starting sizes are not backfilled.
--
-- The rule gets its four factor scores and their reasons
-- (docs/GRANULAR_SCORING_ALGORITHM.md); its points stay as they are until an
-- admin puts the formula's value live from the Admin page, as for every
-- swept action. That fill runs with nobody signed in, so it scores nothing.
--
-- No new table. Safe to re-run.

create or replace function public.token_sizes_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.updated_by is not null and new.updated_by = auth.uid() then
    perform public.record_engagement(new.updated_by, 'added_a_token_size', new.tool, null);
  end if;
  return null;
end;
$$;

drop trigger if exists token_sizes_score on public.token_sizes;
create trigger token_sizes_score
  after insert on public.token_sizes
  for each row
  execute function public.token_sizes_score();

revoke execute on function public.token_sizes_score() from public, anon, authenticated;

-- Its factors and reasons, as the document gives them. Only a row with none
-- yet is filled, so an admin's own scores are never overwritten.
update public.game_scoring_rules
   set effort = 1, value = 2, rarity = 2, farm_risk = 3,
       effort_reason = 'A short form (a name, a size, a colour, a point level): under a minute.',
       value_reason = 'Every member''s earned-points tokens are drawn from the sizes.',
       rarity_reason = 'The sizes are set a handful of times ever, and only an admin can add one.',
       farm_risk_reason = 'A size can be added and removed straight back, so it loops.'
 where kind = 'added_a_token_size'
   and effort is null and value is null and rarity is null and farm_risk is null;

notify pgrst, 'reload schema';
