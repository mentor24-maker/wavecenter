-- The game layer: adding a forum tag now earns its point. The "Added a
-- forum tag" action was listed by the second sweep
-- (20261122140000_scoring_actions_sweep_2.sql, WC-188) but nothing recorded
-- it, so it showed "Not active yet" on Game > Manage. Each swept action is
-- wired by its own ticket (WC-191 for this one).
--
-- A tag is added by inserting a row into forum_tags
-- (20261115210000_forum_topics_tags.sql; addForum in app/forum/actions.ts).
-- Its created_by defaults to auth.uid(), and row-level security only lets a
-- member insert in their own name, so the member credited is the one
-- stamped as its adder. A topic is its own action (added_a_forum_topic) and
-- is not scored here.
--
-- Worth what the rule says at that moment, naming the row's own tool. It
-- runs inside the same save, so a tag and its engagement land together or
-- not at all; a refused insert (a name already on the list, a blank name)
-- records nothing. A tag inserted with the service key (no signed-in
-- member) has nobody to credit, so it earns nothing rather than failing the
-- save. Only tags added after this runs count; nothing is backfilled.
--
-- The rule gets its four factor scores and their reasons
-- (docs/GRANULAR_SCORING_ALGORITHM.md); its points stay as they are until an
-- admin puts the formula's value live from the Admin page, as for every
-- swept action.
--
-- No new table. Safe to re-run.

create or replace function public.forum_tags_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid := auth.uid();
begin
  if v_member is not null and new.created_by is not distinct from v_member then
    perform public.record_engagement(v_member, 'added_a_forum_tag', new.tool, null);
  end if;
  return null;
end;
$$;

drop trigger if exists forum_tags_score on public.forum_tags;
create trigger forum_tags_score
  after insert on public.forum_tags
  for each row execute function public.forum_tags_score();

revoke execute on function public.forum_tags_score() from public, anon, authenticated;

-- Its factors and reasons, as the document gives them. Only a row with none
-- yet is filled, so an admin's own scores are never overwritten.
update public.game_scoring_rules
   set effort = 1, value = 1, rarity = 1, farm_risk = 2,
       effort_reason = 'Typing a tag''s name and saving it is a short form: under a minute.',
       value_reason = 'Adds a label for sorting the Forum, but tags are only listed for now, not yet attached to topics.',
       rarity_reason = 'New tags are added a few times a week at most, not many times a day.',
       farm_risk_reason = 'Repeatable in seconds with a new name each time, but a tag cannot be deleted yet, so it cannot loop.'
 where kind = 'added_a_forum_tag'
   and effort is null and value is null and rarity is null and farm_risk is null;

notify pgrst, 'reload schema';
