-- Evolution: one row per change merged into main, with a screenshot of the
-- screen it changed as it looked at that moment (Dane, 2026-10-30). The rows
-- and pictures are written only by scripts/evolution_capture.mjs on the Mac
-- Mini, with the service key; members only read them. Plain-words
-- explanation: docs/DATA_MODEL.md.
--
-- Additive only. Safe to re-run: every statement checks before it creates.

-- The bucket: private (every read needs a session or a short-lived signed
-- link), PNG only, no picture over 10 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evolution', 'evolution', false, 10485760, array['image/png'])
on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = array['image/png'];

-- Signed-in members may read every screenshot. There is no add, change or
-- delete rule, so nobody can write to the bucket from the browser; only the
-- service key (which skips these rules) can.
drop policy if exists "evolution: members can read" on storage.objects;

create policy "evolution: members can read" on storage.objects
  for select to authenticated
  using (bucket_id = 'evolution');

-- One row per first-parent commit on main.
create table if not exists public.evolution_entries (
  commit_sha      text        primary key check (commit_sha ~ '^[0-9a-f]{40}$'),
  merged_at       timestamptz not null,
  pr_number       integer     check (pr_number > 0),
  title           text        not null check (length(btrim(title)) > 0),
  ticket_url      text,
  page            text,
  screenshot_path text,
  capture_state   text        not null check (capture_state in ('captured', 'no screen', 'failed')),
  failure_reason  text,
  captured_at     timestamptz not null default now(),
  -- A row says "captured" only with its page and its stored picture, and
  -- "failed" only with a reason (engineering rule 6).
  constraint evolution_entries_captured_has_picture
    check (capture_state <> 'captured' or (page is not null and screenshot_path is not null)),
  constraint evolution_entries_failed_has_reason
    check (capture_state <> 'failed' or length(btrim(coalesce(failure_reason, ''))) > 0)
);

-- Engineering rule 2: row-level security is on from the moment the table
-- exists. Start from no rights at all and grant only reading, to signed-in
-- members. The script writes with the service key.
alter table public.evolution_entries enable row level security;

create index if not exists evolution_entries_merged_at_idx on public.evolution_entries (merged_at);

revoke all on public.evolution_entries from anon, authenticated;
grant select on public.evolution_entries to authenticated;
grant select, insert, update, delete on public.evolution_entries to service_role;

drop policy if exists "evolution_entries: members can read" on public.evolution_entries;

create policy "evolution_entries: members can read" on public.evolution_entries
  for select to authenticated
  using (true);
