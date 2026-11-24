-- The game layer: starting a chat now earns its point. The "Started a chat"
-- action was listed by the second sweep
-- (20261122140000_scoring_actions_sweep_2.sql, WC-188) but nothing recorded
-- it, so it showed "Not active yet" on Game > Manage. Each swept action is
-- wired by its own ticket (WC-189 for this one).
--
-- A chat is made only by start_chat (20261113120000_chats_about_a_task.sql),
-- which finds the chat already there for the two members and task, or
-- inserts a new one. So only a new chat is scored: opening a chat that is
-- already there inserts nothing, and earns nothing.
--
-- Credited to the signed-in member who started it (auth.uid(), which
-- start_chat stamps as created_by), worth what the rule says at that moment.
-- chats has no tool column, so the tool is the one the caller names in the
-- x-wavecenter-tool header (the app sends `wavecenter`); a call that names
-- none is recorded as 'supabase-api' rather than refused. It runs inside the
-- same save, so a chat and its engagement land together or not at all. A
-- chat made with the service key (no signed-in member) has nobody to credit,
-- so it earns nothing rather than failing the save. Only chats made after
-- this runs count; nothing is backfilled.
--
-- The rule gets its four factor scores and their reasons
-- (docs/GRANULAR_SCORING_ALGORITHM.md); its points stay as they are until an
-- admin puts the formula's value live from the Admin page, as for every
-- swept action.
--
-- No new table. Safe to re-run.

create or replace function public.chats_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid := auth.uid();
begin
  if v_member is not null and new.created_by is not distinct from v_member then
    perform public.record_engagement(v_member, 'started_a_chat', public.engagement_tool('supabase-api'), null);
  end if;
  return null;
end;
$$;

drop trigger if exists chats_score on public.chats;
create trigger chats_score
  after insert on public.chats
  for each row execute function public.chats_score();

revoke execute on function public.chats_score() from public, anon, authenticated;

-- Its factors and reasons, as the document gives them. Only a row with none
-- yet is filled, so an admin's own scores are never overwritten.
update public.game_scoring_rules
   set effort = 0, value = 1, rarity = 1, farm_risk = 2,
       effort_reason = 'Picking a member and opening the chat is one click.',
       value_reason = 'Opens a line to one other member, not the shared record.',
       rarity_reason = 'A new chat is started a few times a week; most chats are opened again, not started.',
       farm_risk_reason = 'A chat cannot be deleted, so it cannot loop, but a chat about a new task takes seconds.'
 where kind = 'started_a_chat'
   and effort is null and value is null and rarity is null and farm_risk is null;

notify pgrst, 'reload schema';
