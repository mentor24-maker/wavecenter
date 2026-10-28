/**
 * A `TaskStore` that keeps tasks in memory. Core's tests use it so the rules
 * can be checked without a database; it behaves like the real table on the
 * points it matters to (owner set for you, timestamps kept, the update guards,
 * sub-tasks kept as top-level when their parent is deleted).
 *
 * Given an engagement store, it also does what the table's game-layer trigger
 * does: every insert, update and delete records one engagement for the owner,
 * and if that cannot be written the change is not saved either.
 */
import { engagementKindForTask, recordEngagement, type EngagementStore } from './game.ts';
import type { NewTaskRow, Task, TaskRowChanges, TaskStore, UpdateGuard } from './tasks.ts';

export class MemoryTaskStore implements TaskStore {
  readonly rows = new Map<string, Task>();
  private next = 1;
  private readonly ownerId: string;

  private readonly engagements: EngagementStore | null;

  constructor(ownerId = 'member-1', engagements: EngagementStore | null = null) {
    this.ownerId = ownerId;
    this.engagements = engagements;
  }

  private async score(before: Task | null, after: Task | null, tool: string): Promise<void> {
    const task = (after ?? before)!;
    if (this.engagements) {
      await recordEngagement(this.engagements, {
        memberId: task.ownerId,
        kind: engagementKindForTask(before, after),
        tool,
        taskId: task.id,
      });
    }
  }

  async insert(row: NewTaskRow): Promise<Task> {
    const now = new Date().toISOString();
    const task: Task = {
      ...row,
      id: `task-${this.next++}`,
      ownerId: this.ownerId,
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
    if (guard.agentTicketUrl !== undefined && task.agentTicketUrl !== guard.agentTicketUrl) return null;
    const now = new Date().toISOString();
    const updated: Task = { ...task, ...changes, updatedAt: now };
    if (updated.status === 'done' && task.status !== 'done') updated.completedAt = now;
    if (updated.status !== 'done') updated.completedAt = null;
    await this.score(task, updated, changes.tool);
    this.rows.set(id, updated);
    return { ...updated };
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
