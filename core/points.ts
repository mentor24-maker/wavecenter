/**
 * The only functions that may change a task's points.
 *
 * Points are the earliest form of the DEO's engagement ledger, so no tool
 * writes them to the table directly (Dane's decision D on the extension
 * model, 2026-10-11). Every change goes through `setPoints` or `awardPoints`,
 * names the tool that made it, and comes back as a `PointsChange` saying
 * exactly what moved.
 *
 * Dane settled three rules on 2026-10-27 (docs/DATA_MODEL.md, "Points rules"):
 * - A task's points are its suggested value and are never below zero.
 *   Negative values will come later through other records, such as feedback.
 * - Points are locked once the task is done ("for now"). Reopening the task
 *   unlocks them, just as it clears the task's ticket.
 * - The member who adds a task sets its suggested value. The owner-only rule
 *   on the table already ensures that; voting on values is a later table.
 *
 * The owner's score (Dane, 2026-11-03) is that suggested value, kept apart
 * from the task's points so members' votes can never overwrite it. Every
 * change made here sets it; see `ownerScore`. The task's points are then
 * its final score (core/taskScore.ts), which the store works out, so a
 * `PointsChange`'s `after` is the final score, not always the number given.
 */
import { CoreError, requireTool } from './tool.ts';
import { DEFAULT_ROLE, STARTING_ROLE_PERMISSIONS } from './members.ts';
import type { Task, TaskPermissions, TaskStore } from './tasks.ts';

// The table stores points as a PostgreSQL `integer`, checked `>= 0`.
const MAX_POINTS = 2_147_483_647;

/** What one points change did. */
export interface PointsChange {
  taskId: string;
  before: number;
  after: number;
  /** after − before */
  delta: number;
  tool: string;
  /** The task as stored after the change. */
  task: Task;
}

/** Returns `points` if it is a whole number from zero up that the table can hold, or throws. */
export function requirePointsValue(points: unknown): number {
  if (typeof points !== 'number' || !Number.isInteger(points)) {
    throw new CoreError(`Points must be a whole number; got "${String(points)}".`);
  }
  if (points < 0) throw new CoreError(`Points can't be negative; got ${points}.`);
  if (points > MAX_POINTS) throw new CoreError(`Points must be between 0 and ${MAX_POINTS}; got ${points}.`);
  return points;
}

/**
 * The owner's score a task's points give it when its owner sets them, or
 * null for "not set". An owner's 0 is "not set" (Dane, 2026-11-04, "8A" on
 * the design's question 8), because many owners never gave a number. The
 * database's `tasks_owner_points_set` trigger applies exactly this whenever
 * the owner's own change names the task's points, even to the number already
 * there; a vote never does
 * (supabase/migrations/20261104140000_final_task_score.sql).
 */
export function ownerScore(points: number): number | null {
  return requirePointsValue(points) === 0 ? null : points;
}

async function changePoints(
  store: TaskStore,
  taskId: string,
  tool: string,
  next: (current: Task) => number,
  permissions: TaskPermissions,
): Promise<PointsChange> {
  const named = requireTool(tool);
  const current = await store.get(taskId);
  if (!current) {
    // Points stay the owner's (WC-248): a role that may change anyone's
    // task still may not change another member's points.
    if (await store.find(taskId)) {
      throw new CoreError("Only a task's owner may change its points, and this one is another member's. Nothing was changed.");
    }
    throw new CoreError(`No task ${taskId} was found that you may change.`);
  }
  // An owner whose role may not change tasks (a member moved down to viewer,
  // say) is told so up front, not handed a false "try again" when the
  // database refuses the write.
  if (!permissions.includes('task.edit') && !permissions.includes('task.edit.any')) {
    throw new CoreError('Your role may not change tasks. Nothing was changed.');
  }
  if (current.status === 'done') {
    throw new CoreError('This task is done, so its points are locked. Reopen it to change them.');
  }
  const after = requirePointsValue(next(current));
  // Only write if nobody changed the points or the status since we read
  // them, so two changes at once can never silently lose one, and a task
  // finished in the meantime keeps its points locked.
  const task = await store.update(taskId, { points: after, tool: named }, { points: current.points, status: current.status });
  if (!task) {
    throw new CoreError(`Task ${taskId} changed while this change was being made. Nothing was saved; try again.`);
  }
  return { taskId, before: current.points, after: task.points, delta: task.points - current.points, tool: named, task };
}

/**
 * The permissions a member has when none are given: the default role's, the
 * same default core/tasks.ts uses.
 */
const DEFAULT_PERMISSIONS: TaskPermissions = STARTING_ROLE_PERMISSIONS[DEFAULT_ROLE];

/**
 * Set a task's points to `points` on behalf of `tool`. Only the task's owner
 * may, and only while their role's `permissions` let them change tasks.
 */
export async function setPoints(
  store: TaskStore,
  taskId: string,
  points: number,
  tool: string,
  permissions: TaskPermissions = DEFAULT_PERMISSIONS,
): Promise<PointsChange> {
  requireTool(tool);
  const value = requirePointsValue(points);
  return changePoints(store, taskId, tool, () => value, permissions);
}

/** Add `amount` points (a whole number above zero) to a task's owner's score on behalf of `tool`. */
export async function awardPoints(
  store: TaskStore,
  taskId: string,
  amount: number,
  tool: string,
  permissions: TaskPermissions = DEFAULT_PERMISSIONS,
): Promise<PointsChange> {
  requireTool(tool);
  if (amount <= 0) {
    throw new CoreError(`An award must be more than zero points; got ${amount}. Use setPoints to lower a task's points.`);
  }
  requirePointsValue(amount);
  // The award adds to the owner's score, the part the owner sets, not to the
  // final score, which the store works out from every part (core/taskScore.ts).
  return changePoints(store, taskId, tool, (current) => (current.ownerPoints ?? 0) + amount, permissions);
}
