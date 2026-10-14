/**
 * The only functions that may change a task's points.
 *
 * Points are the earliest form of the DEO's engagement ledger, so no tool
 * writes them to the table directly (Dane's decision D on the extension
 * model, 2026-10-11). Every change goes through `setPoints` or `awardPoints`,
 * names the tool that made it, and comes back as a `PointsChange` saying
 * exactly what moved.
 *
 * Open questions the whitepaper does not settle (docs/DATA_MODEL.md): whether
 * points can be negative, whether a finished task's points are fixed, and who
 * sets them before voting exists. Until Dane answers, these functions accept
 * what the table accepts: any whole number.
 */
import { CoreError, requireTool } from './tool.ts';
import type { Task, TaskStore } from './tasks.ts';

// The table stores points as a PostgreSQL `integer`.
const MAX_POINTS = 2_147_483_647;
const MIN_POINTS = -2_147_483_648;

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

/** Returns `points` if it is a whole number the table can hold, or throws. */
export function requirePointsValue(points: unknown): number {
  if (typeof points !== 'number' || !Number.isInteger(points)) {
    throw new CoreError(`Points must be a whole number; got "${String(points)}".`);
  }
  if (points > MAX_POINTS || points < MIN_POINTS) {
    throw new CoreError(`Points must be between ${MIN_POINTS} and ${MAX_POINTS}; got ${points}.`);
  }
  return points;
}

async function changePoints(
  store: TaskStore,
  taskId: string,
  tool: string,
  next: (before: number) => number,
): Promise<PointsChange> {
  const named = requireTool(tool);
  const current = await store.get(taskId);
  if (!current) throw new CoreError(`No task ${taskId} was found that you may change.`);
  const after = requirePointsValue(next(current.points));
  // Only write if nobody changed the points since we read them, so two
  // changes at once can never silently lose one.
  const task = await store.update(taskId, { points: after, tool: named }, { points: current.points });
  if (!task) {
    throw new CoreError(`Task ${taskId}'s points changed while this change was being made. Nothing was saved; try again.`);
  }
  return { taskId, before: current.points, after: task.points, delta: task.points - current.points, tool: named, task };
}

/** Set a task's points to `points` on behalf of `tool`. */
export async function setPoints(store: TaskStore, taskId: string, points: number, tool: string): Promise<PointsChange> {
  requireTool(tool);
  const value = requirePointsValue(points);
  return changePoints(store, taskId, tool, () => value);
}

/** Add `amount` points (a whole number above zero) to a task on behalf of `tool`. */
export async function awardPoints(store: TaskStore, taskId: string, amount: number, tool: string): Promise<PointsChange> {
  requireTool(tool);
  if (requirePointsValue(amount) <= 0) {
    throw new CoreError(`An award must be more than zero points; got ${amount}. Use setPoints to lower a task's points.`);
  }
  return changePoints(store, taskId, tool, (before) => before + amount);
}
