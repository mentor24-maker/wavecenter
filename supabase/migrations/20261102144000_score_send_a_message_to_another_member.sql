-- The game layer: sending a message to another member is scored (Dane,
-- 2026-11-01, on the full list of actions: "B", each listed action wired by
-- its own ticket). The rule itself is already listed
-- (20261102120000_scoring_actions_sweep.sql; on the live site an admin added
-- it through the Add form), so this adds no rule and changes no points.
--
-- Every saved message is recorded inside the same save, credited to its
-- sender and naming its tool: core/messages.ts sendMessage, in SQL. A message
-- is saved only through send_message, so a refused send saves nothing and
-- scores nothing; if the engagement cannot be written, the message is not
-- saved either. A note to oneself is not a message to another member, so it
-- earns nothing.
--
-- No new table. Safe to re-run.

create or replace function public.messages_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.sender_id <> new.recipient_id then
    perform public.record_engagement(new.sender_id, 'send_a_message_to_another_member', new.tool, null);
  end if;
  return null;
end;
$$;

drop trigger if exists messages_score on public.messages;
create trigger messages_score
  after insert on public.messages
  for each row execute function public.messages_score();

revoke execute on function public.messages_score() from public, anon, authenticated;

notify pgrst, 'reload schema';
