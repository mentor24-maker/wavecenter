-- Evolution cards in Dane's own words (Dane, 2026-10-31: "use my prompt
-- only, with a link to the thread"). Each change keeps the words that asked
-- for it and a link to where it was discussed. Filled only by
-- scripts/evolution_capture.mjs on the Mac Mini, with the service key, from
-- the change's ClickUp ticket. Plain-words explanation: docs/DATA_MODEL.md.
--
-- Additive only: two empty columns. Row-level security and the grants on
-- evolution_entries are unchanged (members read, only the script writes).
-- Safe to re-run.

alter table public.evolution_entries add column if not exists prompt text;
alter table public.evolution_entries add column if not exists thread_url text;
