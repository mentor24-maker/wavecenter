/**
 * A `TaskStore` that keeps tasks in memory. Core's tests use it so the rules
 * can be checked without a database; it behaves like the real table on the
 * points it matters to (owner set for you, timestamps kept, the points guard).
 */
import type { NewTaskRow, Task, TaskRowChanges, TaskStore } from './tasks.ts';

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

  async update(id: string, changes: TaskRowChanges, onlyIfPoints?: number): Promise<Task | null> {
    const task = this.rows.get(id);
    if (!task) return null;
    if (onlyIfPoints !== undefined && task.points !== onlyIfPoints) return null;
    const now = new Date().toISOString();
    const updated: Task = { ...task, ...changes, updatedAt: now };
    if (updated.status === 'done' && task.status !== 'done') updated.completedAt = now;
    if (updated.status !== 'done') updated.completedAt = null;
    this.rows.set(id, updated);
    return { ...updated };
  }
}
