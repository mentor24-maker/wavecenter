/**
 * A `TaskStore` that keeps tasks in memory. Core's tests use it so the rules
 * can be checked without a database; it behaves like the real table on the
 * points it matters to (owner set for you, timestamps kept, the update guards,
 * sub-tasks kept as top-level when their parent is deleted).
 */
import type { NewTaskRow, Task, TaskRowChanges, TaskStore, UpdateGuard } from './tasks.ts';

export class MemoryTaskStore implements TaskStore {
  readonly rows = new Map<string, Task>();
  private next = 1;
  private readonly ownerId: string;

  constructor(ownerId = 'member-1') {
    this.ownerId = ownerId;
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
    if (updated.status === 'done' && task.status !== 'done') updated.completedAt = now;
    if (updated.status !== 'done') updated.completedAt = null;
    this.rows.set(id, updated);
    return { ...updated };
  }

  async remove(id: string): Promise<boolean> {
    if (!this.rows.delete(id)) return false;
    for (const task of this.rows.values()) if (task.parentTaskId === id) task.parentTaskId = null;
    return true;
  }
}
