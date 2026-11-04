/**
 * AI task ratings kept in memory, for core's tests. Like the
 * `ai_task_ratings` table, it only ever adds a row, and a rating of a task
 * that does not exist is refused when it is given the task store.
 */
import type { MemoryTaskStore } from './memoryTaskStore.ts';
import type { AiTaskRating, AiTaskRatingStore, NewAiTaskRatingRow } from './taskFactors.ts';

export class MemoryAiTaskRatingStore implements AiTaskRatingStore {
  readonly rows: AiTaskRating[] = [];
  private readonly tasks: MemoryTaskStore | null;
  private next = 1;

  constructor(tasks: MemoryTaskStore | null = null) {
    this.tasks = tasks;
  }

  async insert(row: NewAiTaskRatingRow): Promise<AiTaskRating> {
    if (this.tasks && !this.tasks.rows.has(row.taskId)) throw new Error(`no task ${row.taskId} to rate`);
    // A fresh timestamp per row, so "newest first" is never a tie.
    const saved: AiTaskRating = { ...row, factors: { ...row.factors }, reasons: { ...row.reasons }, id: `rating-${this.next}`, createdAt: new Date(Date.UTC(2026, 10, 4) + this.next * 1000).toISOString() };
    this.next += 1;
    this.rows.push(saved);
    return { ...saved };
  }

  async forTask(taskId: string): Promise<AiTaskRating[]> {
    return this.rows
      .filter((r) => r.taskId === taskId)
      .sort((x, y) => y.createdAt.localeCompare(x.createdAt))
      .map((r) => ({ ...r }));
  }
}
