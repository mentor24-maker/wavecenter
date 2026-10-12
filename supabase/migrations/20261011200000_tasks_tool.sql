-- Every task record names the tool that last changed it (Dane's decision D on
-- the extension model, 2026-10-11; docs/EXTENSION_MODEL.md). WaveCenter's own
-- app is the tool 'wavecenter', which is also what every existing row gets.
-- The functions in core/ (core/tasks.ts, core/points.ts) set it on every
-- write. Plain-words explanation: docs/DATA_MODEL.md.
--
-- Row-level security on `tasks` is unchanged: a new column is covered by the
-- policies already on the table.
--
-- Safe to re-run: every statement checks before it creates.

alter table public.tasks
  add column if not exists tool text not null default 'wavecenter';

alter table public.tasks drop constraint if exists tasks_tool_not_blank;
alter table public.tasks
  add constraint tasks_tool_not_blank check (length(btrim(tool)) > 0);
