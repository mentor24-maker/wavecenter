-- The AI rating lane's pass reports. The lane (scripts/rate_tasks.mjs, run
-- every 30 minutes on the Mac Mini through Claude Code under Dane's plan,
-- decided 2026-11-04: "go with the Mini") rates the open tasks that need it
-- and saves each task's ratings through record_ai_task_rating. Each pass
-- also leaves one row here: when it ran, which Claude sign-in it used, how
-- many tasks it rated, which it could not and why, and how many still wait.
-- The Admin page reads the newest row, and says plainly when no pass has
-- run for over an hour (engineering rule 7).
--
-- A failure reason here is WaveCenter's own plain sentence, never a secret
-- and never a raw answer from the AI.
--
-- Additive only. Safe to re-run: every statement checks before it creates.

create table if not exists public.ai_rating_passes (
  id             uuid        primary key default gen_random_uuid(),
  seq            bigint      generated always as identity,
  started_at     timestamptz not null,
  finished_at    timestamptz not null default now(),
  -- Which Claude sign-in the pass used, e.g. "claude.ai (max plan)". Never a key.
  signed_in_with text        check (signed_in_with is null or char_length(signed_in_with) <= 100),
  rated          integer     not null default 0 check (rated >= 0),
  -- Each task the pass could not rate: [{"task_id", "title", "reason"}].
  failed         jsonb       not null default '[]'::jsonb check (jsonb_typeof(failed) = 'array'),
  waiting        integer     not null default 0 check (waiting >= 0),
  up_to_date     integer     not null default 0 check (up_to_date >= 0),
  -- Set when the whole pass failed (for example it could not sign in to
  -- Claude, or could not read the tasks), so it rated nothing.
  error          text        check (error is null or (error ~ '\S' and char_length(error) <= 1000)),
  tool           text        not null check (tool ~ '\S' and char_length(tool) <= 100),
  constraint ai_rating_passes_finished_after_start check (finished_at >= started_at)
);

create index if not exists ai_rating_passes_newest_idx
  on public.ai_rating_passes (finished_at desc, seq desc);

-- Engineering rule 2: row-level security is on from the moment the table
-- exists. Start from no rights at all: signed-in members read the reports;
-- only the server, with the service key, adds one, or deletes one (the
-- database check clears its own test report). Nobody changes a report.
alter table public.ai_rating_passes enable row level security;

revoke all on public.ai_rating_passes from anon, authenticated, service_role;
grant select on public.ai_rating_passes to authenticated;
grant select, insert, delete on public.ai_rating_passes to service_role;

drop policy if exists "ai_rating_passes: members can read" on public.ai_rating_passes;

create policy "ai_rating_passes: members can read" on public.ai_rating_passes
  for select to authenticated
  using (true);
