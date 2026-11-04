-- The AI's ratings of each task, with their reasons (docs/GLOBULAR_SCORING_ALGORITHM.md,
-- approved by Dane's merge of #146, 2026-11-03). The AI rates a task on four
-- factors, scope, difficulty, relevance and demand, each 1 to 5; the formula
-- turns them into the task's AI score, 1 to 50. Members do not rate factors
-- (Dane's rule, 2026-11-03).
--
-- This table only gives those ratings a home. Nothing writes it yet: the AI
-- job on the server does, in a later ticket, with the service key. Nothing
-- reads it into a task's points yet either.
--
-- The rules live in core/taskFactors.ts (checkTaskFactors,
-- checkTaskFactorReasons, aiScore, checkAiTaskRating); a test keeps the
-- limits here in step with them. Plain-words explanation: docs/DATA_MODEL.md.
--
-- Additive only. Safe to re-run: every statement checks before it creates.

-- One row is one model's rating of one task. A new rating adds a row and
-- never overwrites one, so how a task's AI score moved can always be read
-- back; the newest row is the task's current rating.
create table if not exists public.ai_task_ratings (
  id                  uuid        primary key default gen_random_uuid(),
  task_id             uuid        not null references public.tasks (id) on delete cascade,
  scope               integer     not null check (scope between 1 and 5),
  difficulty          integer     not null check (difficulty between 1 and 5),
  relevance           integer     not null check (relevance between 1 and 5),
  demand              integer     not null check (demand between 1 and 5),
  scope_reason        text        not null check (length(btrim(scope_reason)) between 1 and 300),
  difficulty_reason   text        not null check (length(btrim(difficulty_reason)) between 1 and 300),
  relevance_reason    text        not null check (length(btrim(relevance_reason)) between 1 and 300),
  demand_reason       text        not null check (length(btrim(demand_reason)) between 1 and 300),
  ai_score            integer     not null check (ai_score between 1 and 50),
  model               text        not null check (length(btrim(model)) between 1 and 100),
  instruction_version text        not null check (length(btrim(instruction_version)) between 1 and 40),
  tool                text        not null check (length(btrim(tool)) > 0),
  created_at          timestamptz not null default now(),
  -- The AI score is the formula's, never the AI's own number:
  -- S × D × (R + M) ÷ 5, a half rounding up, never less than 1 (core's aiScore).
  constraint ai_task_ratings_score_is_the_formula
    check (ai_score = greatest(1, round(scope * difficulty * (relevance + demand) / 5.0)::integer))
);

create index if not exists ai_task_ratings_task_newest_idx
  on public.ai_task_ratings (task_id, created_at desc);

-- Engineering rule 2: row-level security is on from the moment the table
-- exists. Start from no rights at all: signed-in members read every rating
-- (auditable parameters), and only the server writes, with the service key.
alter table public.ai_task_ratings enable row level security;

revoke all on public.ai_task_ratings from anon, authenticated;
grant select on public.ai_task_ratings to authenticated;
grant select, insert, update, delete on public.ai_task_ratings to service_role;

drop policy if exists "ai_task_ratings: members can read" on public.ai_task_ratings;

create policy "ai_task_ratings: members can read" on public.ai_task_ratings
  for select to authenticated
  using (true);
