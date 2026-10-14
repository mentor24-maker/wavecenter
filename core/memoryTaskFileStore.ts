/**
 * A `TaskFileStore` that keeps file rows and stored copies in memory, for
 * core's tests. Like the real table, it fills in the owner and the time, and
 * it can be told to fail so the tests can check what a failure leaves behind.
 */
import type { NewTaskFileRow, TaskFile, TaskFileStore } from './files.ts';

export class MemoryTaskFileStore implements TaskFileStore {
  readonly rows = new Map<string, TaskFile>();
  /** Paths of the stored copies. A test "uploads" by adding one here. */
  readonly objects = new Set<string>();
  /** Set to make the next insert, or every object delete, fail. */
  failInsert = false;
  failDeleteObjects = false;
  private next = 1;
  private readonly ownerId: string;

  constructor(ownerId = 'member-1') {
    this.ownerId = ownerId;
  }

  async insert(row: NewTaskFileRow): Promise<TaskFile> {
    if (this.failInsert) throw new Error('the database is down');
    const file: TaskFile = { ...row, id: `file-${this.next++}`, ownerId: this.ownerId, createdAt: new Date().toISOString() };
    this.rows.set(file.id, file);
    return { ...file };
  }

  async get(id: string): Promise<TaskFile | null> {
    const file = this.rows.get(id);
    return file ? { ...file } : null;
  }

  async listForTask(taskId: string): Promise<TaskFile[]> {
    return [...this.rows.values()].filter((f) => f.taskId === taskId).map((f) => ({ ...f }));
  }

  async remove(id: string): Promise<boolean> {
    return this.rows.delete(id);
  }

  async deleteObjects(paths: string[]): Promise<void> {
    if (this.failDeleteObjects) throw new Error('storage is down');
    for (const path of paths) this.objects.delete(path);
  }

  /** What the database's "on delete cascade" does when a task goes. */
  dropRowsFor(taskId: string): void {
    for (const [id, file] of this.rows) if (file.taskId === taskId) this.rows.delete(id);
  }
}
