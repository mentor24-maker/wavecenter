-- Members vote on what each game action is worth (WC-250; the scoring game
-- plan's sub-task 6, docs/SCORING_GAME_PLAN.md; docs/scoring/principles.md,
-- "Members set the values, in the end"). The start of the canon's
-- "continuously voted valuation repository".
--
-- One new table, scoring_rule_votes: one row per member per scoring rule,
-- a whole number of points from 0 up. Every signed-in member reads every vote
-- (the Game page shows their average beside each rule); a member casts,
-- changes and withdraws only their own.
--
-- Collected and shown, not yet counted: nothing here changes a rule's points
-- or any engagement. What an action earns is still the admin's value on
-- game_scoring_rules, until Dane decides how the votes count in it. A vote is
-- not scored as an engagement either.
--
-- Core's rules for it: core/game.ts, castScoringRuleVote and
-- summarizeScoringRuleVotes. Plain-words explanation: docs/DATA_MODEL.md.
-- Additive only: no existing row changes. Safe to re-run: every statement
-- checks before it creates or replaces.

create table if not exists public.scoring_rule_votes (
  kind       text        not null references public.game_scoring_rules (kind) on delete cascade,
  member_id  uuid        not null default auth.uid()
                         references auth.users (id) on delete cascade,
  points     integer     not null check (points >= 0),
  tool       text        not null default 'wavecenter' check (length(btrim(tool)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One vote per member per action: voting again changes it.
  primary key (kind, member_id)
);

-- Engineering rule 2: row-level security is on from the moment the table
-- exists. Start from no rights (Supabase's defaults include TRUNCATE) and
-- grant only the four everyday actions, to signed-in members only.
alter table public.scoring_rule_votes enable row level security;

create index if not exists scoring_rule_votes_member_id_idx on public.scoring_rule_votes (member_id);

revoke all on public.scoring_rule_votes from anon, authenticated;
grant select, insert, update, delete on public.scoring_rule_votes to authenticated;

drop policy if exists "scoring_rule_votes: members can read" on public.scoring_rule_votes;
drop policy if exists "scoring_rule_votes: voter can insert" on public.scoring_rule_votes;
drop policy if exists "scoring_rule_votes: voter can update" on public.scoring_rule_votes;
drop policy if exists "scoring_rule_votes: voter can delete" on public.scoring_rule_votes;

create policy "scoring_rule_votes: members can read" on public.scoring_rule_votes
  for select to authenticated
  using (true);

create policy "scoring_rule_votes: voter can insert" on public.scoring_rule_votes
  for insert to authenticated
  with check ((select auth.uid()) = member_id);

create policy "scoring_rule_votes: voter can update" on public.scoring_rule_votes
  for update to authenticated
  using ((select auth.uid()) = member_id)
  with check ((select auth.uid()) = member_id);

create policy "scoring_rule_votes: voter can delete" on public.scoring_rule_votes
  for delete to authenticated
  using ((select auth.uid()) = member_id);

-- Changing a vote moves its updated_at; created_at stays when it was first cast.
create or replace function public.scoring_rule_votes_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.created_at := old.created_at;
  return new;
end;
$$;

drop trigger if exists scoring_rule_votes_touch on public.scoring_rule_votes;
create trigger scoring_rule_votes_touch
  before update on public.scoring_rule_votes
  for each row execute function public.scoring_rule_votes_touch();

notify pgrst, 'reload schema';
