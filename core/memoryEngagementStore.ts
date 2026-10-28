/**
 * The engagement ledger kept in memory, for core's tests. It starts with
 * WaveCenter's starting scoring rules, and it can be told to fail so the
 * tests can check that a change whose engagement cannot be written is not
 * saved either (what the database's trigger does, in one transaction).
 */
import { STARTING_SCORING_RULES, totalPoints, type Engagement, type EngagementLedger, type EngagementStore, type NewEngagementRow, type ScoringRule } from './game.ts';

export class MemoryEngagementStore implements EngagementStore {
  readonly rows: Engagement[] = [];
  ruleList: ScoringRule[] = STARTING_SCORING_RULES.map((r) => ({ ...r }));
  /** Set to make every insert fail. */
  failInsert = false;
  private next = 1;

  async rules(): Promise<ScoringRule[]> {
    return this.ruleList.map((r) => ({ ...r }));
  }

  async insert(row: NewEngagementRow): Promise<Engagement> {
    if (this.failInsert) throw new Error('the ledger is down');
    const engagement: Engagement = { ...row, id: `engagement-${this.next++}`, createdAt: new Date().toISOString() };
    this.rows.push(engagement);
    return { ...engagement };
  }

  /** One member's view of the ledger, as row-level security gives it to them. */
  ledgerFor(memberId: string): EngagementLedger {
    const mine = () => this.rows.filter((e) => e.memberId === memberId);
    return {
      rules: () => this.rules(),
      latest: async (limit) => mine().reverse().slice(0, limit).map((e) => ({ ...e })),
      total: async () => totalPoints(mine()),
    };
  }
}
