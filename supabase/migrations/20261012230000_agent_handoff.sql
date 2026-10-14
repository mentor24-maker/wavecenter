-- Handing ticked tasks to the AI agents (Dane, 2026-10-12): when a member's
-- "Launch AI Agents" switch is on, the loop-handoff lane files each ticked
-- task as a Loop Queue ticket in ClickUp and records the ticket's link here.
-- A task with a link is "with the AI agents"; it is never handed off twice.
-- Plain-words explanation: docs/DATA_MODEL.md.
--
-- Additive only: every existing task starts with no link. Row-level security
-- on `tasks` is unchanged: a new column is covered by the policies already on
-- the table. Safe to re-run: every statement checks before it creates.

alter table public.tasks
  add column if not exists agent_ticket_url text;

alter table public.tasks drop constraint if exists tasks_agent_ticket_url_not_blank;
alter table public.tasks
  add constraint tasks_agent_ticket_url_not_blank
  check (agent_ticket_url is null or length(btrim(agent_ticket_url)) > 0);
