/**
 * Votes kept in memory, for core's tests. One `MemoryVoteStore` holds every
 * member's votes; `as(memberId)` is one member's `VoteStore`, which, like the
 * table's row-level security, reads everyone's votes but writes only that
 * member's own.
 *
 * Given the task store, it also does what the table's vote trigger does:
 * after every vote it sets the task's points and priority from the votes
 * (`votedValues`), and a vote on a task that does not exist is refused.
 * Given an engagement store, every vote is recorded and scored for the voter.
 */
import { recordEngagement, type EngagementStore } from './game.ts';
import type { MemoryTaskStore } from './memoryTaskStore.ts';
import { votedValues, type Vote, type VoteRow, type VoteStore } from './votes.ts';

export class MemoryVoteStore {
  readonly rows = new Map<string, Vote>();
  private readonly tasks: MemoryTaskStore | null;
  private readonly engagements: EngagementStore | null;

  constructor(tasks: MemoryTaskStore | null = null, engagements: EngagementStore | null = null) {
    this.tasks = tasks;
    this.engagements = engagements;
  }

  /** Score the vote first: if that fails, the vote is not saved either. */
  private async score(taskId: string, memberId: string, tool: string): Promise<void> {
    if (this.engagements) await recordEngagement(this.engagements, { memberId, kind: 'voted_on_task', tool, taskId });
  }

  private average(taskId: string, tool: string): void {
    const task = this.tasks?.rows.get(taskId);
    if (!task) return;
    const values = votedValues(task, [...this.rows.values()].filter((v) => v.taskId === taskId));
    if (values) this.tasks!.rows.set(taskId, { ...task, ...values, tool, updatedAt: new Date().toISOString() });
  }

  /** One member's view: everyone's votes to read, only their own to write. */
  as(memberId: string): VoteStore {
    const key = (taskId: string) => `${taskId}:${memberId}`;
    return {
      mine: async (taskId) => {
        const vote = this.rows.get(key(taskId));
        return vote ? { ...vote } : null;
      },
      forTask: async (taskId) => [...this.rows.values()].filter((v) => v.taskId === taskId).map((v) => ({ ...v })),
      save: async (row: VoteRow) => {
        if (this.tasks && !this.tasks.rows.has(row.taskId)) throw new Error(`no task ${row.taskId} to vote on`);
        const now = new Date().toISOString();
        const before = this.rows.get(key(row.taskId));
        const vote: Vote = { ...row, memberId, createdAt: before?.createdAt ?? now, updatedAt: now };
        await this.score(row.taskId, memberId, row.tool);
        this.rows.set(key(row.taskId), vote);
        this.average(row.taskId, row.tool);
        return { ...vote };
      },
      remove: async (taskId, tool) => {
        if (!this.rows.has(key(taskId))) return false;
        await this.score(taskId, memberId, tool);
        this.rows.delete(key(taskId));
        this.average(taskId, tool);
        return true;
      },
    };
  }
}
