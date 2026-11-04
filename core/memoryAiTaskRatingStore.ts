/**
 * AI task ratings kept in memory, for core's tests. Like the
 * `ai_task_ratings` tables, it only ever adds a pass, and a rating of a task
 * that does not exist is refused when it is given the task store. Given the
 * task store, a new pass also sets the task's points to its final score
 * (core/taskScore.ts), as `ai_task_ratings_apply` does.
 */
import type { MemoryTaskStore } from './memoryTaskStore.ts';
import type { AiTaskRating, AiTaskRatingStore, NewAiTaskRatingRow } from './taskFactors.ts';

const copy = (r: AiTaskRating): AiTaskRating => ({
  ...r,
  factors: { ...r.factors },
  models: r.models.map((m) => ({ ...m, factors: { ...m.factors }, reasons: { ...m.reasons } })),
});

export class MemoryAiTaskRatingStore implements AiTaskRatingStore {
  readonly rows: AiTaskRating[] = [];
  private readonly tasks: MemoryTaskStore | null;
  private next = 1;

  constructor(tasks: MemoryTaskStore | null = null) {
    this.tasks = tasks;
    if (tasks) {
      tasks.aiScoreFor = (taskId) => {
        const newest = this.rows.map((r, seq) => ({ r, seq })).filter(({ r }) => r.taskId === taskId)
          .sort((x, y) => y.r.createdAt.localeCompare(x.r.createdAt) || y.seq - x.seq)[0];
        return newest?.r.aiScore ?? null;
      };
    }
  }

  async insert(row: NewAiTaskRatingRow): Promise<AiTaskRating> {
    if (this.tasks && !this.tasks.rows.has(row.taskId)) throw new Error(`no task ${row.taskId} to rate`);
    // Every pass gets the same timestamp, as passes saved at one moment do;
    // the order they were added breaks the tie, as `seq` does in the table.
    const saved = copy({ ...row, id: `rating-${this.next}`, createdAt: new Date(Date.UTC(2026, 10, 4)).toISOString() } as AiTaskRating);
    this.next += 1;
    this.rows.push(saved);
    this.tasks?.refreshPoints(row.taskId, row.tool);
    return copy(saved);
  }

  async forTask(taskId: string): Promise<AiTaskRating[]> {
    return this.rows
      .map((r, seq) => ({ r, seq }))
      .filter(({ r }) => r.taskId === taskId)
      .sort((x, y) => y.r.createdAt.localeCompare(x.r.createdAt) || y.seq - x.seq)
      .map(({ r }) => copy(r));
  }
}
