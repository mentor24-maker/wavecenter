/**
 * What a task is worth: its final score, which is its points.
 *
 * Dane's rule (2026-11-03, on "Scoring system for Globular scores (epic
 * parent)"): "We will average the AI score and the human score to arrive at
 * the final score. Later, we will add a third factor, which is the average of
 * all the other users' scores. Then we'll take the average of all three
 * scores: AI, owner, others."
 *
 * His answers on "Factor ratings do not set a task's points yet: connect
 * them" (2026-11-04, 12:45 PM MT, "B" and "A" to the design's questions 1
 * and 2), with his clarification: "Since the voting is working, the final
 * score is going to be the average of three scores: Owner's score, AI score,
 * Average of other users' scores". So, for every task:
 *
 * - **AI score**: the newest AI rating's score (core/taskFactors.ts `aiScore`).
 * - **Owner's score**: the points the owner gave it (core/points.ts
 *   `ownerScore`); an owner's 0 is "not set".
 * - **Others' score**: the plain average of the points votes of every member
 *   other than the owner, a half rounding up. The owner's own vote is not an
 *   "other user's score": it counts for priority, not here.
 * - **Final score** = the plain average of the parts the task has, a half
 *   rounding up. A part the task does not have yet is left out, so a task is
 *   never stuck (the design, "The later step"); with none at all it is 0.
 * - **Before the AI has rated it** the final score stands, marked
 *   provisional until the AI rates it (his "B" on question 1).
 * - **A done task's points are locked** (core/points.ts): nothing here moves
 *   them until the task is reopened.
 *
 * The database applies exactly this in the same save as every change to a
 * part (supabase/migrations/20261104140000_final_task_score.sql,
 * `private.task_final_points`); core's in-memory stores apply it through
 * `finalScore`, so the tests prove the rule.
 */
import type { Task } from './tasks.ts';
import type { Vote } from './votes.ts';

/** The three parts of a task's score. Null is a part the task does not have yet. */
export interface TaskScoreParts {
  ai: number | null;
  owner: number | null;
  others: number | null;
}

/** A whole number, a half rounding up. Tidied first so 2.5 that floats as 2.4999… still rounds up. */
function roundHalfUp(n: number): number {
  return Math.round(Number(n.toFixed(9)));
}

/** The others' score: the average of every other member's points vote, or null when no other member has voted on the points. */
export function othersScore(
  ownerId: string,
  votes: readonly Pick<Vote, 'memberId' | 'points'>[],
): { score: number | null; votes: number } {
  const points = votes.filter((v) => v.memberId !== ownerId && v.points !== null).map((v) => v.points as number);
  if (!points.length) return { score: null, votes: 0 };
  return { score: roundHalfUp(points.reduce((sum, p) => sum + p, 0) / points.length), votes: points.length };
}

/** The final score: the plain average of the parts the task has, a half rounding up; 0 when it has none. */
export function finalScore(parts: TaskScoreParts): number {
  const present = [parts.ai, parts.owner, parts.others].filter((p): p is number => p !== null);
  if (!present.length) return 0;
  return roundHalfUp(present.reduce((sum, p) => sum + p, 0) / present.length);
}

/** Everything the task page needs to say how a task's points were reached. */
export interface TaskScore extends TaskScoreParts {
  /** How many other members' points votes make the others' score. */
  othersVotes: number;
  /** What the rule gives today. */
  final: number;
  /** The task's points as stored: the final score, or, on a done task, the score it was locked at. */
  points: number;
  /** The AI has not rated it yet, so the final score is provisional. */
  provisional: boolean;
  /** The task is done, so its points are locked. */
  locked: boolean;
}

/** A task's score, from the task, its AI score (null when the AI has not rated it) and every member's votes on it. */
export function taskScore(
  task: Pick<Task, 'ownerId' | 'ownerPoints' | 'status' | 'points'>,
  ai: number | null,
  votes: readonly Pick<Vote, 'memberId' | 'points'>[],
): TaskScore {
  const others = othersScore(task.ownerId, votes);
  const parts = { ai, owner: task.ownerPoints, others: others.score };
  const locked = task.status === 'done';
  const final = finalScore(parts);
  return { ...parts, othersVotes: others.votes, final, points: locked ? task.points : final, provisional: ai === null, locked };
}

/**
 * How the points were worked out, in one line: "AI 12, owner 10, final 11";
 * "AI: not yet, owner 10, final 10 (provisional until the AI rates it)".
 */
export function taskScoreLine(s: TaskScore): string {
  const parts = [
    s.ai === null ? 'AI: not yet' : `AI ${s.ai}`,
    s.owner === null ? 'owner: not set' : `owner ${s.owner}`,
    ...(s.others === null ? [] : [`others ${s.others} (${s.othersVotes} vote${s.othersVotes === 1 ? '' : 's'})`]),
    `final ${s.final}`,
  ];
  let line = parts.join(', ');
  if (s.provisional) line += ' (provisional until the AI rates it)';
  if (s.locked && s.points !== s.final) line += `. The task is done, so its points stay locked at ${s.points}`;
  return line;
}

/** The design's worked examples (docs/GLOBULAR_SCORING_ALGORITHM.md) and the ticket's own. A test checks each. */
export const FINAL_SCORE_EXAMPLES: readonly { task: string; parts: TaskScoreParts; final: number }[] = [
  { task: 'Create basic game layer management.', parts: { ai: 36, owner: 50, others: null }, final: 43 },
  { task: 'Set up a proper registration/login process, including Google Oauth login', parts: { ai: 13, owner: 30, others: null }, final: 22 },
  { task: 'Create a user-facing game dashboard.', parts: { ai: 17, owner: 20, others: null }, final: 19 },
  { task: 'Use the other version of the header background.', parts: { ai: 1, owner: 5, others: null }, final: 3 },
  { task: 'Create a user-facing game dashboard, with three other members’ scores (15, 20 and 25)', parts: { ai: 17, owner: 20, others: 20 }, final: 19 },
  { task: 'The ticket’s test task', parts: { ai: 12, owner: 10, others: null }, final: 11 },
];
