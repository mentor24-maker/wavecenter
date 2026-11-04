-- The AI's ratings of each task, with their reasons (docs/GLOBULAR_SCORING_ALGORITHM.md,
-- approved by Dane's merge of #146, 2026-11-03). The AI rates a task on four
-- factors, scope, difficulty, relevance and demand, each 1 to 5; the formula
-- turns them into the task's AI score, 1 to 50. Members do not rate factors
-- (Dane's rule, 2026-11-03).
--
-- Two models rate every task, separately (the design, "Which models"). One
-- rating pass is kept as the design's "How its reasons are kept" says:
--   ai_task_ratings        one row per pass: the task, when, the instruction
--                          version, a fingerprint of what the AI read, and
--                          the averaged ratings with the AI score they make;
--   ai_task_model_ratings  one row per model in that pass: its exact id,
--                          its four ratings and its four reasons.
-- A pass is saved whole, by record_ai_task_rating, or not at all.
--
-- This only gives those ratings a home. Nothing writes it yet: the AI job on
-- the server does, in a later ticket, with the service key. Nothing reads it
-- into a task's points yet either.
--
-- The rules live in core/taskFactors.ts (checkTaskFactors,
-- checkTaskFactorReasons, aiScore, checkAiTaskRating); a test keeps the
-- limits here in step with them. Plain-words explanation: docs/DATA_MODEL.md.
--
-- Additive only. Safe to re-run: every statement checks before it creates.

-- One row is one rating pass of one task. A new pass adds a row and never
-- overwrites one, so how a task's AI score moved can always be read back;
-- the newest row is the task's current rating. `seq` breaks a tie between
-- two passes saved at the same moment.
create table if not exists public.ai_task_ratings (
  id                  uuid        primary key default gen_random_uuid(),
  seq                 bigint      generated always as identity,
  task_id             uuid        not null references public.tasks (id) on delete cascade,
  -- Each the plain average of the models' ratings, not rounded.
  scope               numeric     not null check (scope between 1 and 5),
  difficulty          numeric     not null check (difficulty between 1 and 5),
  relevance           numeric     not null check (relevance between 1 and 5),
  demand              numeric     not null check (demand between 1 and 5),
  ai_score            integer     not null check (ai_score between 1 and 50),
  instruction_version text        not null check (instruction_version ~ '\S' and char_length(instruction_version) <= 40),
  fingerprint         text        not null check (fingerprint ~ '\S' and char_length(fingerprint) <= 128),
  tool                text        not null check (tool ~ '\S' and char_length(tool) <= 100),
  created_at          timestamptz not null default now(),
  -- The AI score is the formula's, never the AI's own number:
  -- S × D × (R + M) ÷ 5, rounded once, a half rounding up, never less than 1 (core's aiScore).
  constraint ai_task_ratings_score_is_the_formula
    check (ai_score = greatest(1, round(scope * difficulty * (relevance + demand) / 5)::integer))
);

create index if not exists ai_task_ratings_task_newest_idx
  on public.ai_task_ratings (task_id, created_at desc, seq desc);

-- One row is one model's part of a pass. A model rates a task once per pass.
create table if not exists public.ai_task_model_ratings (
  id                  uuid    primary key default gen_random_uuid(),
  rating_id           uuid    not null references public.ai_task_ratings (id) on delete cascade,
  model               text    not null check (model ~ '\S' and char_length(model) <= 100),
  scope               integer not null check (scope between 1 and 5),
  difficulty          integer not null check (difficulty between 1 and 5),
  relevance           integer not null check (relevance between 1 and 5),
  demand              integer not null check (demand between 1 and 5),
  scope_reason        text    not null check (scope_reason ~ '\S' and char_length(scope_reason) <= 300),
  difficulty_reason   text    not null check (difficulty_reason ~ '\S' and char_length(difficulty_reason) <= 300),
  relevance_reason    text    not null check (relevance_reason ~ '\S' and char_length(relevance_reason) <= 300),
  demand_reason       text    not null check (demand_reason ~ '\S' and char_length(demand_reason) <= 300),
  constraint ai_task_model_ratings_one_per_model unique (rating_id, model)
);

-- Engineering rule 2: row-level security is on from the moment each table
-- exists. Start from no rights at all: signed-in members read every rating
-- (auditable parameters). Nobody writes the tables directly, not even the
-- service key: a pass goes in only through record_ai_task_rating, whole, and
-- is never changed or deleted afterwards. Deleting the task still takes its
-- ratings with it (the foreign keys cascade as the tables' owner).
alter table public.ai_task_ratings enable row level security;
alter table public.ai_task_model_ratings enable row level security;

revoke all on public.ai_task_ratings from anon, authenticated, service_role;
revoke all on public.ai_task_model_ratings from anon, authenticated, service_role;
grant select on public.ai_task_ratings to authenticated, service_role;
grant select on public.ai_task_model_ratings to authenticated, service_role;

drop policy if exists "ai_task_ratings: members can read" on public.ai_task_ratings;
create policy "ai_task_ratings: members can read" on public.ai_task_ratings
  for select to authenticated
  using (true);

drop policy if exists "ai_task_model_ratings: members can read" on public.ai_task_model_ratings;
create policy "ai_task_model_ratings: members can read" on public.ai_task_model_ratings
  for select to authenticated
  using (true);

-- The history is kept as it was. Grants already stop every API role; this
-- also stops the database's own owner from editing a rating in place.
create or replace function private.ai_ratings_are_kept()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'An AI rating is kept as it was made; a new rating adds a new pass. Nothing was changed.' using errcode = '42501';
end;
$$;

drop trigger if exists ai_task_ratings_are_kept on public.ai_task_ratings;
create trigger ai_task_ratings_are_kept
  before update on public.ai_task_ratings
  for each row execute function private.ai_ratings_are_kept();

drop trigger if exists ai_task_model_ratings_are_kept on public.ai_task_model_ratings;
create trigger ai_task_model_ratings_are_kept
  before update on public.ai_task_model_ratings
  for each row execute function private.ai_ratings_are_kept();

-- Save one whole pass: the parent row and one row per model, in this one
-- transaction. The averages and the AI score are worked out here from the
-- models' own ratings, so they cannot disagree with them. `models` is a JSON
-- array of {model, scope, difficulty, relevance, demand, scope_reason,
-- difficulty_reason, relevance_reason, demand_reason}. A pass with no
-- model, or any part off the scale or blank, saves nothing. The server only.
create or replace function public.record_ai_task_rating(
  task uuid, instruction_version text, fingerprint text, tool text, models jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if models is null or jsonb_typeof(models) <> 'array' or jsonb_array_length(models) = 0 then
    raise exception 'A rating pass needs at least one model''s rating. Nothing was saved.' using errcode = '22023';
  end if;

  with pass as (
    select btrim(m->>'model') as model,
           (m->>'scope')::integer as scope, (m->>'difficulty')::integer as difficulty,
           (m->>'relevance')::integer as relevance, (m->>'demand')::integer as demand,
           btrim(m->>'scope_reason') as scope_reason, btrim(m->>'difficulty_reason') as difficulty_reason,
           btrim(m->>'relevance_reason') as relevance_reason, btrim(m->>'demand_reason') as demand_reason
      from jsonb_array_elements(models) m
  ), averaged as (
    select avg(scope) as s, avg(difficulty) as d, avg(relevance) as r, avg(demand) as m from pass
  ), parent as (
    insert into public.ai_task_ratings (task_id, scope, difficulty, relevance, demand, ai_score, instruction_version, fingerprint, tool)
    select task, a.s, a.d, a.r, a.m,
           greatest(1, round(a.s * a.d * (a.r + a.m) / 5)::integer),
           btrim(instruction_version), btrim(fingerprint), btrim(tool)
      from averaged a
    returning id
  ), children as (
    insert into public.ai_task_model_ratings (rating_id, model, scope, difficulty, relevance, demand,
                                              scope_reason, difficulty_reason, relevance_reason, demand_reason)
    select parent.id, p.model, p.scope, p.difficulty, p.relevance, p.demand,
           p.scope_reason, p.difficulty_reason, p.relevance_reason, p.demand_reason
      from pass p cross join parent
    returning rating_id
  )
  select id into v_id from parent;

  return v_id;
end;
$$;

revoke execute on function public.record_ai_task_rating(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_ai_task_rating(uuid, text, text, text, jsonb) to service_role;
