/**
 * A `TaskCommentStore` that keeps comments in memory, for core's tests. Like
 * the real table, it fills in the owner and the times, and it can be told to
 * fail so the tests can check what a failure leaves behind. Given an
 * engagement store, it scores posting and deleting a comment the way the
 * table's game-layer triggers do, all-or-nothing.
 */
import { recordEngagement, type EngagementStore } from './game.ts';
import type { NewTaskCommentRow, TaskComment, TaskCommentStore } from './comments.ts';

export class MemoryTaskCommentStore implements TaskCommentStore {
  readonly rows = new Map<string, TaskComment>();
  /** Set to make the next insert fail. */
  failInsert = false;
  private next = 1;
  private readonly ownerId: string;
  private readonly engagements: EngagementStore | null;

  constructor(ownerId = 'member-1', engagements: EngagementStore | null = null) {
    this.ownerId = ownerId;
    this.engagements = engagements;
  }

  async insert(row: NewTaskCommentRow): Promise<TaskComment> {
    if (this.failInsert) throw new Error('the database is down');
    const now = new Date(Date.UTC(2026, 9, 27, 0, 0, this.next)).toISOString();
    const comment: TaskComment = { ...row, id: `comment-${this.next++}`, ownerId: this.ownerId, createdAt: now, updatedAt: now };
    if (this.engagements) {
      await recordEngagement(this.engagements, { memberId: comment.ownerId, kind: 'posted_a_comment', tool: row.tool, taskId: comment.taskId });
    }
    this.rows.set(comment.id, comment);
    return { ...comment };
  }

  async get(id: string): Promise<TaskComment | null> {
    const comment = this.rows.get(id);
    return comment ? { ...comment } : null;
  }

  async update(id: string, body: string, tool: string): Promise<TaskComment | null> {
    const comment = this.rows.get(id);
    if (!comment || comment.ownerId !== this.ownerId) return null;
    const changed = { ...comment, body, tool, updatedAt: new Date().toISOString() };
    this.rows.set(id, changed);
    return { ...changed };
  }

  async remove(id: string, tool: string): Promise<boolean> {
    const comment = this.rows.get(id);
    if (!comment || comment.ownerId !== this.ownerId) return false;
    if (this.engagements) {
      await recordEngagement(this.engagements, { memberId: comment.ownerId, kind: 'deleted_a_comment', tool, taskId: comment.taskId });
    }
    return this.rows.delete(id);
  }

  /** What the database's "on delete cascade" does when a task goes. Not scored: deleting the task was. */
  dropRowsFor(taskId: string): void {
    for (const [id, comment] of this.rows) if (comment.taskId === taskId) this.rows.delete(id);
  }
}
