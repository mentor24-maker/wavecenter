-- The game layer: making a proposal now earns its point. The "Made a
-- proposal" action was listed by the second sweep
-- (20261122140000_scoring_actions_sweep_2.sql, WC-188) but nothing recorded
-- it, so it showed "Not active yet" on Game > Manage. Each swept action is
-- wired by its own ticket (WC-192 for this one).
--
-- A proposal is made by inserting a row into proposals
-- (20261102210000_proposals.sql; addProposal in app/proposals/actions.ts).
-- Its owner_id defaults to auth.uid(), and row-level security only lets a
-- member insert in their own name, so the member credited is the proposal's
-- owner, and only when that is the signed-in member. Changing and deleting
-- a proposal are their own actions (changed_a_proposal,
-- deleted_a_proposal) and are not scored here.
--
-- Worth what the rule says at that moment, naming the row's own tool. It
-- runs inside the same save, so a proposal and its engagement land together
-- or not at all; a refused insert (a blank title, another member's name)
-- records nothing. A proposal inserted with the service key (no signed-in
-- member) has nobody to credit, so it earns nothing rather than failing the
-- save. Only proposals made after this runs count; nothing is backfilled.
--
-- The rule gets its four factor scores and their reasons
-- (docs/GRANULAR_SCORING_ALGORITHM.md); its points stay as they are until an
-- admin puts the formula's value live from the Admin page, as for every
-- swept action.
--
-- No new table. Safe to re-run.

create or replace function public.proposals_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid := auth.uid();
begin
  if v_member is not null and new.owner_id is not distinct from v_member then
    perform public.record_engagement(v_member, 'made_a_proposal', new.tool, null);
  end if;
  return null;
end;
$$;

drop trigger if exists proposals_score on public.proposals;
create trigger proposals_score
  after insert on public.proposals
  for each row execute function public.proposals_score();

revoke execute on function public.proposals_score() from public, anon, authenticated;

-- Its factors and reasons, as the document gives them. Only a row with no
-- factors yet is filled, and each reason only where an admin has not written
-- one (set_scoring_factor_reasons saves reasons without factors), so an
-- admin's own scores and reasons are never overwritten.
update public.game_scoring_rules
   set effort = 1, value = 2, rarity = 0, farm_risk = 3,
       effort_reason = coalesce(effort_reason, 'Typing a title and saving it is a short form: under a minute.'),
       value_reason = coalesce(value_reason, 'Puts an idea the other members can read on the Proposals page, and it could become a task.'),
       rarity_reason = coalesce(rarity_reason, 'Members can make proposals many times a day.'),
       farm_risk_reason = coalesce(farm_risk_reason, 'Paired with deleting it, so make-and-delete loops.')
 where kind = 'made_a_proposal'
   and effort is null and value is null and rarity is null and farm_risk is null;

notify pgrst, 'reload schema';
