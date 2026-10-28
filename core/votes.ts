/**
 * Members' votes on what a task is worth and how urgent it is.
 *
 * Dane, 2026-10-27: "allow all users to vote on all tasks in terms of
 * priority and point values ... The actual value will be the average of all
 * users' votes. (for now)" He then settled three questions on the ticket:
 * votes go on the task list for now, every member sees every task (notes and
 * files too), and once members have voted the average replaces the owner's own
 * points and priority.
 *
 * The rules:
 * - Each member has at most one vote per task, made of a points vote, a
 *   priority vote, or both. Voting again replaces it; a member can withdraw
 *   either part, or both.
 * - A points vote is a whole number from zero up (the same rule as a task's
 *   points, core/points.ts). A priority vote is one of the four priorities.
 * - **Points:** the plain average of the points votes, rounded to the nearest
 *   whole number, a half rounding up (4 and 5 make 5).
 * - **Priority:** each word counts as a number, urgent 4, high 3, normal 2,
 *   low 1; the average is rounded the same way and turned back into a word
 *   (high and low make normal; high and normal make high).
 * - Once a task has a points vote, its points are the average, and the owner
 *   cannot type over it; the same for priority. With no votes, the owner's own
 *   value stands.
 * - A done task's points are locked (core/points.ts), so votes on it are kept
 *   and shown, but they do not change it.
 *
 * The database applies the average itself, in the same save as the vote
 * (supabase/migrations/20261028140000_task_votes.sql), because a member
 * voting on someone else's task may not write that task. It follows exactly
 * `votedValues` below; core's in-memory store (memoryVoteStore.ts) applies it
 * through the same function, so the tests prove the rule.
 */
import { CoreError, requireTool } from './tool.ts';
import { requirePointsValue } from './points.ts';
import { requirePriority, type Task, type TaskPriority } from './tasks.ts';

/** What each priority counts as when votes are averaged. */
export const PRIORITY_WEIGHT: Readonly<Record<TaskPriority, number>> = { urgent: 4, high: 3, normal: 2, low: 1 };

/** One row of `task_votes`: one member's vote on one task. */
export interface Vote {
  taskId: string;
  memberId: string;
  /** Null when the member has not voted on the points. */
  points: number | null;
  /** Null when the member has not voted on the priority. */
  priority: TaskPriority | null;
  /** The tool that last saved it. */
  tool: string;
  createdAt: string;
  updatedAt: string;
}

/** The fields a store writes. The voter is always the signed-in member. */
export interface VoteRow {
  taskId: string;
  points: number | null;
  priority: TaskPriority | null;
  tool: string;
}

/** What core needs from storage, acting as one signed-in member. */
export interface VoteStore {
  /** The member's own vote on a task, or null. */
  mine(taskId: string): Promise<Vote | null>;
  /** Every member's vote on a task. */
  forTask(taskId: string): Promise<Vote[]>;
  /** Save the member's own vote, replacing the one they already cast. */
  save(row: VoteRow): Promise<Vote>;
  /** Withdraw the member's own vote on behalf of `tool`. False if there was none. */
  remove(taskId: string, tool: string): Promise<boolean>;
}

/**
 * A member's choice. Leave a part out to keep it as it is; set it to null to
 * withdraw that part.
 */
export interface VoteChoice {
  points?: number | null;
  priority?: TaskPriority | null;
}

/** The average, rounded to the nearest whole number, a half rounding up. Null with no values. */
function roundedAverage(values: readonly number[]): number | null {
  if (!values.length) return null;
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
}

/** The average of some points votes, or null when there are none. */
export function averagePoints(points: readonly number[]): number | null {
  return roundedAverage(points);
}

/** The average of some priority votes, or null when there are none. */
export function averagePriority(priorities: readonly TaskPriority[]): TaskPriority | null {
  const weight = roundedAverage(priorities.map((p) => PRIORITY_WEIGHT[p]));
  if (weight === null) return null;
  return (Object.keys(PRIORITY_WEIGHT) as TaskPriority[]).find((p) => PRIORITY_WEIGHT[p] === weight)!;
}

/** What a task's votes add up to. */
export interface VoteSummary {
  /** Members who have voted on it at all. */
  voters: number;
  /** The average points, or null when nobody has voted on the points. */
  points: number | null;
  pointsVotes: number;
  /** The averaged priority, or null when nobody has voted on the priority. */
  priority: TaskPriority | null;
  priorityVotes: number;
}

export function summarizeVotes(votes: readonly Pick<Vote, 'points' | 'priority'>[]): VoteSummary {
  const points = votes.map((v) => v.points).filter((p): p is number => p !== null);
  const priorities = votes.map((v) => v.priority).filter((p): p is TaskPriority => p !== null);
  return {
    voters: votes.filter((v) => v.points !== null || v.priority !== null).length,
    points: averagePoints(points),
    pointsVotes: points.length,
    priority: averagePriority(priorities),
    priorityVotes: priorities.length,
  };
}

/**
 * What a task's points and priority become from its votes, or null when the
 * votes change nothing: the task is done (its points are locked), or nobody
 * has voted. A part nobody has voted on keeps the task's own value. The
 * database's vote trigger applies exactly this.
 */
export function votedValues(
  task: Pick<Task, 'status' | 'points' | 'priority'>,
  votes: readonly Pick<Vote, 'points' | 'priority'>[],
): { points: number; priority: TaskPriority } | null {
  if (task.status === 'done') return null;
  const summary = summarizeVotes(votes);
  if (!summary.voters) return null;
  return { points: summary.points ?? task.points, priority: summary.priority ?? task.priority };
}

/**
 * Cast, change or withdraw the signed-in member's vote on a task, on behalf
 * of `tool`. Returns the vote as saved, or null once nothing of it is left.
 */
export async function castVote(store: VoteStore, taskId: string, choice: VoteChoice, tool: string): Promise<Vote | null> {
  const named = requireTool(tool);
  if (typeof taskId !== 'string' || !taskId) throw new CoreError('A vote must say which task it is on.');
  if (choice.points === undefined && choice.priority === undefined) {
    throw new CoreError('A vote needs points, a priority, or both.');
  }
  const points = choice.points === undefined || choice.points === null ? choice.points : requirePointsValue(choice.points);
  const priority = choice.priority === undefined || choice.priority === null ? choice.priority : requirePriority(choice.priority);
  const current = await store.mine(taskId);
  const next = {
    points: points === undefined ? (current?.points ?? null) : points,
    priority: priority === undefined ? (current?.priority ?? null) : priority,
  };
  if (next.points === null && next.priority === null) {
    if (current) await store.remove(taskId, named);
    return null;
  }
  return store.save({ taskId, ...next, tool: named });
}

/**
 * Refuse an owner's own change to a task's points or priority once members
 * have voted on it: from then on the average decides (Dane, 2026-10-27).
 */
export function requireNotVotedOn(votes: readonly Pick<Vote, 'points' | 'priority'>[], part: 'points' | 'priority'): void {
  if (votes.some((v) => v[part] !== null)) {
    throw new CoreError(
      `Members have voted on this task's ${part}, so ${part === 'points' ? 'its points are' : 'its priority is'} the average of their votes. Cast your own vote instead.`,
    );
  }
}
