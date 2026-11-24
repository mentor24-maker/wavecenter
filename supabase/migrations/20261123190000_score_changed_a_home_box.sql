-- The game layer: changing a Home box now earns its point. The "Changed a
-- Home box" action was listed by the second sweep
-- (20261122140000_scoring_actions_sweep_2.sql, WC-188) but nothing recorded
-- it, so it showed "Not active yet" on Game > Manage. Each swept action is
-- wired by its own ticket (WC-195 for this one).
--
-- A box's words are saved by an upsert into home_boxes
-- (20261102130000_home_boxes.sql; saveHomeBoxAction in app/homeActions.ts):
-- an insert the first time a box is saved, an update after that. Row-level
-- security only lets a role with home.edit save, and home_boxes_stamp sets
-- updated_by to auth.uid(), so the member credited is the signed-in one who
-- saved. Saving the same words again changes nothing and is not counted.
--
-- Worth what the rule says at that moment, naming the row's own tool. It
-- runs inside the same save, so the words and their engagement land
-- together or not at all; a refused save records nothing. A save with the
-- service key (no signed-in member) has nobody to credit, so it earns
-- nothing rather than failing the save. Only changes after this runs count;
-- nothing is backfilled.
--
-- The rule gets its four factor scores and their reasons
-- (docs/GRANULAR_SCORING_ALGORITHM.md); its points stay as they are until an
-- admin puts the formula's value live from the Admin page, as for every
-- swept action.
--
-- No new table. Safe to re-run.

create or replace function public.home_boxes_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid := auth.uid();
begin
  if v_member is not null
     and (tg_op = 'INSERT' or old.body is distinct from new.body) then
    perform public.record_engagement(v_member, 'changed_a_home_box', new.tool, null);
  end if;
  return null;
end;
$$;

drop trigger if exists home_boxes_score on public.home_boxes;
create trigger home_boxes_score
  after insert or update on public.home_boxes
  for each row execute function public.home_boxes_score();

revoke execute on function public.home_boxes_score() from public, anon, authenticated;

-- Its factors and reasons, as the document gives them. Only a row with none
-- yet is filled, so an admin's own scores are never overwritten.
update public.game_scoring_rules
   set effort = 1, value = 2, rarity = 1, farm_risk = 3,
       effort_reason = 'Rewording a box and saving it is one short form.',
       value_reason = 'Every member reads these words each time they open Home.',
       rarity_reason = 'Home''s words change a few times a week at most, and only a role with Edit Home boxes may.',
       farm_risk_reason = 'The words can be changed straight back, so it loops.'
 where kind = 'changed_a_home_box'
   and effort is null and value is null and rarity is null and farm_risk is null;

notify pgrst, 'reload schema';
