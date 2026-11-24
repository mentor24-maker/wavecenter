-- The game layer: starring a message now earns its point. The "Starred a
-- message" action was listed by the second sweep
-- (20261122140000_scoring_actions_sweep_2.sql, WC-188) but nothing recorded
-- it, so it showed "Not active yet" on Game > Manage. Each swept action is
-- wired by its own ticket (WC-196 for this one).
--
-- A star is saved only through set_message_mark
-- (20261122120000_message_marks.sql; markMyMessage in app/profile/actions.ts),
-- which writes the caller's own row of message_marks: an insert the first
-- time a member marks a message, an update after that. The member credited
-- is the signed-in one whose mark it is. Only a message that was not starred
-- becoming starred counts: taking a star off, starring it again while it is
-- starred, and the trash (in or out) score nothing.
--
-- Worth what the rule says at that moment, naming the mark's own tool. It
-- runs inside the same save, so the star and its engagement land together
-- or not at all; a refused mark records nothing. A write with the service
-- key (no signed-in member), or one that names a member other than the one
-- signed in, has nobody to credit, so it earns nothing rather than failing
-- the save. Only stars after this runs count; nothing is backfilled.
--
-- The rule gets its four factor scores and their reasons
-- (docs/GRANULAR_SCORING_ALGORITHM.md); its points stay as they are until an
-- admin puts the formula's value live from the Admin page, as for every
-- swept action.
--
-- No new table. Safe to re-run.

create or replace function public.message_marks_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid := auth.uid();
begin
  if v_member is not null
     and new.member_id = v_member
     and new.starred
     and (tg_op = 'INSERT' or not old.starred) then
    perform public.record_engagement(v_member, 'starred_a_message', new.tool, null);
  end if;
  return null;
end;
$$;

drop trigger if exists message_marks_score on public.message_marks;
create trigger message_marks_score
  after insert or update of starred on public.message_marks
  for each row execute function public.message_marks_score();

revoke execute on function public.message_marks_score() from public, anon, authenticated;

-- Its factors and reasons, as the document gives them. Only a row with none
-- yet is filled, so an admin's own scores are never overwritten.
update public.game_scoring_rules
   set effort = 0, value = 0, rarity = 0, farm_risk = 3,
       effort_reason = 'One click on the Star.',
       value_reason = 'A private mark: nobody else sees it, so it does nothing for anyone else.',
       rarity_reason = 'Members can star messages many times a day.',
       farm_risk_reason = 'A star can be taken off and put back, so it loops.'
 where kind = 'starred_a_message'
   and effort is null and value is null and rarity is null and farm_risk is null;

notify pgrst, 'reload schema';
