/**
 * The globular half of scoring, starting with tasks: the four factors the AI
 * rates every task on, the test for each level, the formula from those
 * ratings to the task's AI score, and the record of each rating with its
 * reasons. From docs/GLOBULAR_SCORING_ALGORITHM.md, which Dane approved by
 * merging it (#146, 2026-11-03).
 *
 * Dane's rule (2026-11-03): "These ratings will be the AI-generated scores.
 * [...] We will average the AI score and the human score to arrive at the
 * final score." And: "the factors are used by AI to derive their final point
 * value for the score. It is that final point value that is being averaged
 * with the human scores." So members do not rate factors; the AI does, and
 * the server, not the AI, does the arithmetic (`aiScore`).
 *
 * This file only gives the ratings a home. Nothing here calls an AI service,
 * changes a task's points or averages with the owner's score; later tickets
 * do. The table is `ai_task_ratings`
 * (supabase/migrations/20261104120000_ai_task_factor_ratings.sql), which
 * checks the same limits; a test keeps the two in step. Every signed-in
 * member reads it; only the server, with the service key, writes it.
 *
 * Plain-words description: docs/DATA_MODEL.md.
 */
import { CoreError, requireTool } from './tool.ts';

/** One task's four factor ratings, each a whole number from 1 to 5. */
export interface TaskFactors {
  /** S, how much there is to do. */
  scope: number;
  /** D, how hard it is to get right. */
  difficulty: number;
  /** R, how closely it serves the mission. */
  relevance: number;
  /** M, how much it is wanted. */
  demand: number;
}
export type TaskFactorKey = keyof TaskFactors;

export const TASK_FACTOR_KEYS: readonly TaskFactorKey[] = ['scope', 'difficulty', 'relevance', 'demand'];

/** Dane's 5-point scale. There is no 0: every task has some of each factor. */
export const TASK_FACTOR_MIN = 1;
export const TASK_FACTOR_MAX = 5;

/** The highest and lowest AI score the formula can give. */
export const AI_SCORE_MIN = 1;
export const AI_SCORE_MAX = 50;

/** Why the AI gave each rating, one sentence per factor. Every one is required. */
export type TaskFactorReasons = Record<TaskFactorKey, string>;

/** The longest a reason may be. The database checks the same. */
export const TASK_REASON_MAX = 300;
/** The longest a model id may be. The database checks the same. */
export const MODEL_MAX = 100;
/** The longest an instruction version may be. The database checks the same. */
export const INSTRUCTION_VERSION_MAX = 40;

/**
 * Each factor's name, letter, what it measures and the test for each level,
 * levels[0] being 1 and levels[4] being 5, word for word from the design.
 */
export const TASK_FACTOR_TESTS: Record<TaskFactorKey, { name: string; letter: string; measures: string; levels: readonly string[] }> = {
  scope: {
    name: 'Scope', letter: 'S',
    measures: 'How much there is to do.',
    levels: [
      'One small change in one place: a colour, a word, a size.',
      'A few related changes on one screen, or one small new piece.',
      'A new feature on one screen, or a change touching several screens.',
      'A new section of the site, or a feature with its own database table.',
      'A whole system, or a parent task that is split into many sub-tasks.',
    ],
  },
  difficulty: {
    name: 'Difficulty', letter: 'D',
    measures: 'How hard it is to get right.',
    levels: [
      'Anyone could do it from the description; nothing to work out.',
      'One or two choices to make; the way to do it is well known.',
      'Needs real thought or an outside service (email, sign-in, files).',
      "Easy to get wrong in ways that matter: security, money, other members' data, or many moving parts.",
      'Nobody knows yet how to do it; the design has to be worked out first.',
    ],
  },
  relevance: {
    name: 'Relevance', letter: 'R',
    measures: "How closely it serves the mission, measured against WaveCenter's path in CLAUDE.md and docs/MISSION.md.",
    levels: [
      'A matter of taste: it looks or reads a little better.',
      'Makes something that exists easier or nicer to use.',
      'Adds something members use to do the work.',
      'Builds a step of the path: project management, inviting members, or the game layer.',
      'Foundation the rest is built on: the game layer substrate, the task record, scoring itself.',
    ],
  },
  demand: {
    name: 'Demand', letter: 'M',
    measures: 'How much it is wanted.',
    levels: [
      'Nice to have; nobody is waiting for it.',
      'One member asked for it, with no date in mind.',
      'Members would notice it soon, or it is marked high priority.',
      'Members are held back without it, or other tasks are waiting on it.',
      'Blocking: work is stopped, something is broken, or it is marked urgent.',
    ],
  },
};

function rating(value: unknown, key: TaskFactorKey): number {
  const n = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < TASK_FACTOR_MIN || n > TASK_FACTOR_MAX) {
    throw new CoreError(`${TASK_FACTOR_TESTS[key].name} must be a whole number from ${TASK_FACTOR_MIN} to ${TASK_FACTOR_MAX}. Nothing was saved.`);
  }
  return n;
}

/** The four ratings, checked. A missing one or one outside 1 to 5 is refused: a task is rated on all four or not at all. */
export function checkTaskFactors(input: unknown): TaskFactors {
  if (input == null || typeof input !== 'object') {
    throw new CoreError('A task is rated on scope, difficulty, relevance and demand, and none was given. Nothing was saved.');
  }
  const given = input as Record<string, unknown>;
  const missing = TASK_FACTOR_KEYS.filter((k) => given[k] == null || (typeof given[k] === 'string' && !(given[k] as string).trim()));
  if (missing.length) {
    throw new CoreError(`Rate all four factors; ${missing.map((k) => TASK_FACTOR_TESTS[k].name.toLowerCase()).join(' and ')} ${missing.length === 1 ? 'is' : 'are'} missing. Nothing was saved.`);
  }
  return {
    scope: rating(given.scope, 'scope'),
    difficulty: rating(given.difficulty, 'difficulty'),
    relevance: rating(given.relevance, 'relevance'),
    demand: rating(given.demand, 'demand'),
  };
}

/** The four reasons, each trimmed. A blank or missing one, or one over TASK_REASON_MAX, is refused: every rating shows its reason. */
export function checkTaskFactorReasons(input: unknown): TaskFactorReasons {
  if (input == null || typeof input !== 'object') {
    throw new CoreError('Every rating needs its reason, and none was given. Nothing was saved.');
  }
  const given = input as Record<string, unknown>;
  const reasons = {} as TaskFactorReasons;
  for (const k of TASK_FACTOR_KEYS) {
    const name = TASK_FACTOR_TESTS[k].name;
    const text = typeof given[k] === 'string' ? (given[k] as string).trim() : '';
    if (!text) throw new CoreError(`${name} needs a reason saying which test the task meets and why. Nothing was saved.`);
    if (text.length > TASK_REASON_MAX) throw new CoreError(`${name}'s reason is ${text.length} characters; the most is ${TASK_REASON_MAX}. Nothing was saved.`);
    reasons[k] = text;
  }
  return reasons;
}

/** A whole number, a half rounding up, as votes are (core/votes.ts). Tidied first so 2.5 that floats as 2.4999… still rounds up. */
function roundHalfUp(n: number): number {
  return Math.round(Number(n.toFixed(9)));
}

function rawScore(f: TaskFactors): number {
  return (f.scope * f.difficulty * (f.relevance + f.demand)) / 5;
}

/**
 * The formula: AI score = S × D × (R + M) ÷ 5, rounded to a whole number, a
 * half rounding up, and never less than 1. It runs from 1 to 50.
 *
 * Given more than one model's ratings, each factor is their plain average,
 * not rounded, and only the AI score is rounded (the design, "The formula":
 * "Rounding happens once").
 */
export function aiScore(ratings: TaskFactors | readonly TaskFactors[]): number {
  const list = (Array.isArray(ratings) ? ratings : [ratings]).map(checkTaskFactors);
  if (!list.length) throw new CoreError('There is no rating to work out an AI score from.');
  const avg = (k: TaskFactorKey) => list.reduce((sum, f) => sum + f[k], 0) / list.length;
  const averaged = { scope: avg('scope'), difficulty: avg('difficulty'), relevance: avg('relevance'), demand: avg('demand') };
  return Math.max(AI_SCORE_MIN, roundHalfUp(rawScore(averaged)));
}

/** The formula's arithmetic for one rating, written out: "3 × 3 × (3 + 4) ÷ 5 = 12.6, so 13". It ends in `aiScore`. */
export function aiScoreWorking(factors: TaskFactors): string {
  const f = checkTaskFactors(factors);
  const raw = Number(rawScore(f).toFixed(9));
  const score = aiScore(f);
  return `${f.scope} × ${f.difficulty} × (${f.relevance} + ${f.demand}) ÷ 5 = ${raw}${raw === score ? '' : `, so ${score}`}`;
}

/** The design's worked examples on real WaveCenter tasks. A test checks each `aiScore`. */
export const AI_SCORE_EXAMPLES: readonly { task: string; factors: TaskFactors; aiScore: number }[] = [
  { task: 'Create basic game layer management.', factors: { scope: 5, difficulty: 4, relevance: 5, demand: 4 }, aiScore: 36 },
  { task: 'Set up a proper registration/login process, including Google Oauth login', factors: { scope: 3, difficulty: 3, relevance: 3, demand: 4 }, aiScore: 13 },
  { task: 'Create a user-facing game dashboard.', factors: { scope: 4, difficulty: 3, relevance: 4, demand: 3 }, aiScore: 17 },
  { task: 'Use the other version of the header background.', factors: { scope: 1, difficulty: 1, relevance: 1, demand: 2 }, aiScore: 1 },
];

/** One row of `ai_task_ratings`: one model's rating of one task. A new rating adds a row; none is ever overwritten. */
export interface AiTaskRating {
  id: string;
  taskId: string;
  factors: TaskFactors;
  reasons: TaskFactorReasons;
  /** Worked out by `aiScore` from `factors`, never taken from the AI. */
  aiScore: number;
  /** The model's exact id, such as "claude-opus-5-5". */
  model: string;
  /** The version of the instructions it was given. */
  instructionVersion: string;
  /** The tool that saved it. */
  tool: string;
  createdAt: string;
}

/** The fields a store writes for a new rating. Every one was checked here. */
export type NewAiTaskRatingRow = Omit<AiTaskRating, 'id' | 'createdAt'>;

/** What the server hands in. There is deliberately no AI score field: the formula sets it. */
export interface AiTaskRatingInput {
  taskId: string;
  factors: unknown;
  reasons: unknown;
  model: unknown;
  instructionVersion: unknown;
  tool: string;
}

/** What core needs to keep the ratings. An adapter decides nothing. */
export interface AiTaskRatingStore {
  insert(row: NewAiTaskRatingRow): Promise<AiTaskRating>;
  /** Every rating of the task, newest first. */
  forTask(taskId: string): Promise<AiTaskRating[]>;
}

function label(value: unknown, what: string, max: number): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new CoreError(`A rating must say ${what}, and none was given. Nothing was saved.`);
  if (text.length > max) throw new CoreError(`The ${what} is ${text.length} characters; the most is ${max}. Nothing was saved.`);
  return text;
}

/** A whole rating, checked, with its AI score worked out. Refuses a missing or malformed part, and any AI score it is handed. */
export function checkAiTaskRating(input: AiTaskRatingInput): NewAiTaskRatingRow {
  if (input && typeof input === 'object' && 'aiScore' in input) {
    throw new CoreError('The AI score is worked out from the four ratings; it cannot be handed in. Nothing was saved.');
  }
  if (typeof input?.taskId !== 'string' || !input.taskId) throw new CoreError('A rating must name its task. Nothing was saved.');
  const factors = checkTaskFactors(input.factors);
  return {
    taskId: input.taskId,
    factors,
    reasons: checkTaskFactorReasons(input.reasons),
    aiScore: aiScore(factors),
    model: label(input.model, 'which model made it', MODEL_MAX),
    instructionVersion: label(input.instructionVersion, 'which version of the instructions it was given', INSTRUCTION_VERSION_MAX),
    tool: requireTool(input.tool),
  };
}

/** Check a rating and save it as a new row. A refused rating saves nothing. */
export async function recordAiTaskRating(store: AiTaskRatingStore, input: AiTaskRatingInput): Promise<AiTaskRating> {
  return store.insert(checkAiTaskRating(input));
}

/** The task's current AI rating: its newest row, or null if the AI has not rated it yet. */
export async function currentAiTaskRating(store: AiTaskRatingStore, taskId: string): Promise<AiTaskRating | null> {
  const [latest] = await store.forTask(taskId);
  return latest ?? null;
}
