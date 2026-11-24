-- The game layer: deleting a token size now earns its point. The "Deleted a
-- token size" action was listed by the second sweep
-- (20261122140000_scoring_actions_sweep_2.sql, WC-188) but nothing recorded
-- it, so it showed "Not active yet" on Game > Manage. Each swept action is
-- wired by its own ticket (WC-201 for this one).
--
-- A token size is deleted on Game > Manage (deleteTokenSize in
-- app/game/manage/actions.ts, removeTokenSize in core/tokens.ts), which
-- deletes one row of token_sizes (20261103150000_token_settings.sql). What
-- counts: a token size is deleted. Adding a size and changing one are their
-- own actions (each has its own ticket); neither is this.
--
-- Credited to the member signed in now (auth.uid()), since a deleted row's
-- updated_by names whoever last changed it, not who deleted it. A delete made
-- with the service key (a migration, or a check putting sizes back) has
-- nobody signed in, so it is made unscored rather than refused. Worth what
-- the rule says at that moment, naming the delete's own tool from the
-- x-wavecenter-tool header (public.engagement_tool), or the row's tool
-- without one. It runs inside the same delete, so the delete and its
-- engagement land together or not at all; a refused or failed delete records
-- nothing. Only deletes made after this runs count; nothing is backfilled.
--
-- token_sizes is no other table's child, so no cascade deletes a size; every
-- delete is one an admin (or the service key) asked for.
--
-- The rule gets its four factor scores and their reasons
-- (docs/GRANULAR_SCORING_ALGORITHM.md); its points stay as they are until an
-- admin puts the formula's value live from the Admin page, as for every
-- swept action. That fill runs with nobody signed in, so it scores nothing.
--
-- No new table. Safe to re-run.

create or replace function public.token_sizes_score_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid := auth.uid();
begin
  if v_member is not null then
    perform public.record_engagement(v_member, 'deleted_a_token_size', public.engagement_tool(old.tool), null);
  end if;
  return null;
end;
$$;

drop trigger if exists token_sizes_score_delete on public.token_sizes;
create trigger token_sizes_score_delete
  after delete on public.token_sizes
  for each row
  execute function public.token_sizes_score_delete();

revoke execute on function public.token_sizes_score_delete() from public, anon, authenticated;

-- Its factors and reasons, as the document gives them. Only a row with none
-- yet is filled, so an admin's own scores are never overwritten.
update public.game_scoring_rules
   set effort = 0, value = 1, rarity = 1, farm_risk = 3,
       effort_reason = 'One click.',
       value_reason = 'Tidies up the list of sizes every member''s tokens are drawn from.',
       rarity_reason = 'Only an admin can delete a size, and there are only a handful to delete.',
       farm_risk_reason = 'The undo half of the add-and-delete loop.'
 where kind = 'deleted_a_token_size'
   and effort is null and value is null and rarity is null and farm_risk is null;

notify pgrst, 'reload schema';
