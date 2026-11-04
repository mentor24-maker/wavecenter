/**
 * The words of a task page's "How this task is scored" section
 * (app/tasks/TaskScore.tsx), kept apart from the page so a test checks them.
 * Every number comes from core: the AI score from core/taskFactors.ts
 * (`aiScore`), the final score from core/taskScore.ts (`taskScore`). This
 * file only writes out the arithmetic that gives them, so any member can
 * check how a number was reached.
 */
import { modelsDisagreeOn, TASK_FACTOR_KEYS, type AiModelRating, type TaskFactorKey, type TaskFactors } from '../../core/taskFactors.ts';
import type { TaskScore } from '../../core/taskScore.ts';

/** The newest AI rating pass of a task, as the page reads it. */
export interface AiRatingView {
  /** Each factor, the plain average of the models' ratings (may be a half, such as 3.5). */
  factors: TaskFactors;
  aiScore: number;
  /** Each model's own ratings and reasons. */
  models: AiModelRating[];
  instructionVersion: string;
  createdAt: string;
}

/** A row of `ai_task_ratings` with its `ai_task_model_ratings` embedded, as Supabase returns it. */
export interface AiRatingRow {
  scope: number | string;
  difficulty: number | string;
  relevance: number | string;
  demand: number | string;
  ai_score: number;
  instruction_version: string;
  created_at: string;
  ai_task_model_ratings: {
    model: string;
    scope: number;
    difficulty: number;
    relevance: number;
    demand: number;
    scope_reason: string;
    difficulty_reason: string;
    relevance_reason: string;
    demand_reason: string;
  }[] | null;
}

/** The database row, in core's shape. `numeric` columns can arrive as text, so each is read as a number. */
export function ratingFromRow(row: AiRatingRow): AiRatingView {
  const models = [...(row.ai_task_model_ratings ?? [])]
    .sort((a, b) => a.model.localeCompare(b.model))
    .map((m) => ({
      model: m.model,
      factors: { scope: m.scope, difficulty: m.difficulty, relevance: m.relevance, demand: m.demand },
      reasons: { scope: m.scope_reason, difficulty: m.difficulty_reason, relevance: m.relevance_reason, demand: m.demand_reason },
    }));
  return {
    factors: { scope: Number(row.scope), difficulty: Number(row.difficulty), relevance: Number(row.relevance), demand: Number(row.demand) },
    aiScore: row.ai_score,
    models,
    instructionVersion: row.instruction_version,
    createdAt: row.created_at,
  };
}

/** A number as a person writes it: 3, 3.5, 12.6; never 3.5000000001. */
export function plainNumber(n: number): string {
  return String(Number(n.toFixed(2)));
}

/** "3 × 3.5 × (3 + 4) ÷ 5 = 14.7, so 15": the formula with the averaged ratings, ending in the stored AI score. */
export function aiScoreSum(r: AiRatingView): string {
  const f = r.factors;
  const raw = Number(((f.scope * f.difficulty * (f.relevance + f.demand)) / 5).toFixed(2));
  const shown = plainNumber(raw);
  return `${plainNumber(f.scope)} × ${plainNumber(f.difficulty)} × (${plainNumber(f.relevance)} + ${plainNumber(f.demand)}) ÷ 5 = ${shown}${raw === r.aiScore ? '' : `, so ${r.aiScore}`}`;
}

/** The factors on which the models are 2 or more levels apart, by name: "the AI models disagree" (the design, "Which models"). */
export function disagreement(r: AiRatingView): TaskFactorKey[] {
  return modelsDisagreeOn(r.models);
}

/** The order the factors are shown in: the design's. */
export const FACTOR_ORDER = TASK_FACTOR_KEYS;

/** The names of the parts the task has, in core's order. */
function partNames(s: TaskScore): string[] {
  return [
    ...(s.ai === null ? [] : ['the AI score']),
    ...(s.owner === null ? [] : ["the owner's score"]),
    ...(s.others === null ? [] : ["the other members' score"]),
  ];
}

/**
 * The final score's working, from the parts the task has:
 * "(12 + 10) ÷ 2 = 11, the average of the AI score and the owner's score";
 * "(13 + 30) ÷ 2 = 21.5, so 22, …"; one part alone is the final score as it
 * stands ("the owner's score on its own"); with none it is 0.
 */
export function finalScoreWorking(s: TaskScore): string {
  const parts = [s.ai, s.owner, s.others].filter((p): p is number => p !== null);
  const names = partNames(s);
  if (!parts.length) return 'no score has been given yet, so 0';
  if (parts.length === 1) return `${names[0]} on its own`;
  const raw = Number((parts.reduce((sum, p) => sum + p, 0) / parts.length).toFixed(2));
  const sum = `(${parts.join(' + ')}) ÷ ${parts.length} = ${plainNumber(raw)}${raw === s.final ? '' : `, so ${s.final}`}`;
  return `${sum}, the average of ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
