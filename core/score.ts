/**
 * A member's score from their finished tasks: how many tasks they have
 * finished and the total of those tasks' points values. Only a task whose
 * status is `done` counts; anything else adds nothing, however many points it
 * carries. Every client (the Game page today, member-built tools later) adds
 * up a score through this one function, so the rule lives in one place.
 *
 * This is separate from the engagement ledger in `game.ts`, which scores each
 * action a member takes. Here the points are the ones set on each task.
 */
import type { Task } from './tasks.ts';

export interface TaskScore {
  /** The sum of `points` across the finished tasks. */
  total: number;
  /** How many tasks are finished. */
  finished: number;
}

/** Add up the score of `tasks`: only finished (`done`) tasks count. */
export function scoreFinishedTasks(tasks: readonly Pick<Task, 'status' | 'points'>[]): TaskScore {
  let total = 0;
  let finished = 0;
  for (const task of tasks) {
    if (task.status !== 'done') continue;
    finished += 1;
    total += task.points;
  }
  return { total, finished };
}
