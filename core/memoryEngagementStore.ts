/**
 * The engagement ledger kept in memory, for core's tests. It starts with
 * WaveCenter's starting scoring rules, and it can be told to fail so the
 * tests can check that a change whose engagement cannot be written is not
 * saved either (what the database's trigger does, in one transaction).
 * It also holds the rules for `changeScoringRule` and `addScoringRule`; like
 * the database's functions it writes what it is given, and the rules about
 * who may are core's.
 */
import {
  STARTING_SCORING_RULES, totalPoints, type Engagement, type EngagementLedger, type EngagementStore, type NewEngagementRow,
  type RuleFields, type ScoringRule, type ScoringRuleStore,
} from './game.ts';

export class MemoryEngagementStore implements EngagementStore, ScoringRuleStore {
  readonly rows: Engagement[] = [];
  ruleList: ScoringRule[] = STARTING_SCORING_RULES.map((r) => ({ ...r }));
  /** Set to make every insert fail. */
  failInsert = false;
  /** Set to make the next rule save write nothing, the way a refused write does. */
  failNextRuleSave = false;
  /** The tool that last changed each rule. */
  readonly ruleTools = new Map<string, string>();
  private next = 1;

  async rules(): Promise<ScoringRule[]> {
    return this.ruleList.map((r) => ({ ...r }));
  }

  async update(kind: string, fields: RuleFields, tool: string): Promise<ScoringRule | null> {
    if (this.failNextRuleSave) {
      this.failNextRuleSave = false;
      return null;
    }
    const at = this.ruleList.findIndex((r) => r.kind === kind);
    if (at < 0) return null;
    this.ruleList[at] = { ...this.ruleList[at], ...fields };
    this.ruleTools.set(kind, tool);
    return { ...this.ruleList[at] };
  }

  async add(kind: string, fields: RuleFields, tool: string): Promise<ScoringRule | null> {
    if (this.failNextRuleSave) {
      this.failNextRuleSave = false;
      return null;
    }
    const rule = { kind, ...fields, position: Math.max(0, ...this.ruleList.map((r) => r.position)) + 1 };
    this.ruleList.push(rule);
    this.ruleTools.set(kind, tool);
    return { ...rule };
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
