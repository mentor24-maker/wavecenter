/**
 * A `TaskStore` that keeps tasks in memory. Core's tests use it so the rules
 * can be checked without a database; it behaves like the real table on the
 * points it matters to (owner set for you, timestamps kept, the owner's score
 * kept, the update guards, sub-tasks kept as top-level when their parent is
 * deleted).
 *
 * Given an engagement store, it also does what the table's game-layer trigger
 * does: every insert, update and delete records one engagement for the owner,
 * and if that cannot be written the change is not saved either. A save that
 * changes nothing records nothing, and a task earns "Finished a task" once. Approving a
 * proposed task is also scored for `signedIn`, the admin the database would
 * see as signed in, as `tasks_score_approval` does.
 *
 * Like the table's `tasks_points_final` trigger, every change to a task that
 * is not done keeps its points at the final score (core/taskScore.ts),
 * reading its AI score and votes from the rating and vote stores built on
 * this one (`aiScoreFor`, `votesFor`).
 */
import { engagementKindForTask, recordEngagement, taskChanged, type EngagementStore } from './game.ts';
import { ownerScore } from './points.ts';
import { finalScore, othersScore } from './taskScore.ts';
import type { NewTaskRow, Task, TaskRowChanges, TaskStore, UpdateGuard } from './tasks.ts';
import type { Vote } from './votes.ts';

export class MemoryTaskStore implements TaskStore {
  readonly rows = new Map<string, Task>();
  private next = 1;
  private readonly ownerId: string;
  /** Who the database would see as signed in: the admin credited for an approval. */
  signedIn: string | null = null;

  private readonly engagements: EngagementStore | null;

  /** The task's current AI score, or null; MemoryAiTaskRatingStore sets it. */
  aiScoreFor: (taskId: string) => number | null = () => null;
  /** Every member's votes on the task; MemoryVoteStore sets it. */
  votesFor: (taskId: string) => readonly Vote[] = () => [];

  /** The final score the task's parts give it now. */
  finalFor(task: Task): number {
    return finalScore({ ai: this.aiScoreFor(task.id), owner: task.ownerPoints, others: othersScore(task.ownerId, this.votesFor(task.id)).score });
  }

  /**
   * As the database does when a vote or an AI rating lands: a task that is
   * not done takes its final score, on behalf of `tool`, and nobody is
   * scored for it (it is not the owner's doing).
   */
  refreshPoints(id: string, tool: string): void {
    const task = this.rows.get(id);
    if (!task || task.status === 'done') return;
    const points = this.finalFor(task);
    if (points !== task.points) this.rows.set(id, { ...task, points, tool, updatedAt: new Date().toISOString() });
  }

  constructor(ownerId = 'member-1', engagements: EngagementStore | null = null) {
    this.ownerId = ownerId;
    this.engagements = engagements;
  }

  /** The tasks that have earned "Finished a task", as the trigger reads them from the ledger. */
  private readonly finished = new Set<string>();

  private async score(before: Task | null, after: Task | null, tool: string): Promise<void> {
    const task = (after ?? before)!;
    if (!this.engagements) return;
    // A save that changed nothing records nothing.
    if (before && after && !taskChanged(before, after)) return;
    const kind = engagementKindForTask(before, after, this.finished.has(task.id));
    await recordEngagement(this.engagements, { memberId: task.ownerId, kind, tool, taskId: task.id });
    if (kind === 'finished_task') this.finished.add(task.id);
  }

  async insert(row: NewTaskRow): Promise<Task> {
    const now = new Date().toISOString();
    const task: Task = {
      ...row,
      id: `task-${this.next++}`,
      ownerId: this.ownerId,
      ownerPoints: ownerScore(row.points),
      createdAt: now,
      updatedAt: now,
      completedAt: row.status === 'done' ? now : null,
    };
    await this.score(null, task, row.tool);
    this.rows.set(task.id, task);
    return { ...task };
  }

  async get(id: string): Promise<Task | null> {
    const task = this.rows.get(id);
    return task ? { ...task } : null;
  }

  async update(id: string, changes: TaskRowChanges, guard: UpdateGuard = {}): Promise<Task | null> {
    const task = this.rows.get(id);
    if (!task) return null;
    if (guard.points !== undefined && task.points !== guard.points) return null;
    if (guard.status !== undefined && task.status !== guard.status) return null;
    if (guard.agentTicketUrl !== undefined && task.agentTicketUrl !== guard.agentTicketUrl) return null;
    const now = new Date().toISOString();
    const updated: Task = { ...task, ...changes, updatedAt: now };
    const stillDone = task.status === 'done' && updated.status === 'done';
    // As tasks_owner_points_set: the owner's own change to the points, even to
    // the number already there, is the owner's score.
    if (changes.points !== undefined && !stillDone) updated.ownerPoints = ownerScore(changes.points);
    // As tasks_points_final: the points are the final score, unless the task stays done.
    if (!stillDone) updated.points = this.finalFor(updated);
    if (updated.status === 'done' && task.status !== 'done') updated.completedAt = now;
    if (updated.status !== 'done') updated.completedAt = null;
    await this.score(task, updated, changes.tool);
    this.rows.set(id, updated);
    return { ...updated };
  }

  async approve(id: string, tool: string): Promise<Task | null> {
    if (this.rows.get(id)?.status !== 'proposed') return null;
    // Score first: if that fails, the task is not approved either, as in one transaction.
    if (this.engagements && this.signedIn) {
      await recordEngagement(this.engagements, { memberId: this.signedIn, kind: 'approved_a_proposed_task', tool, taskId: id });
    }
    return this.update(id, { status: 'todo', tool }, { status: 'proposed' });
  }

  async remove(id: string, tool: string): Promise<boolean> {
    const task = this.rows.get(id);
    if (!task) return false;
    await this.score(task, null, tool);
    this.rows.delete(id);
    // Like the database's "on delete set null", which is not counted as a change.
    for (const task of this.rows.values()) if (task.parentTaskId === id) task.parentTaskId = null;
    return true;
  }
}
