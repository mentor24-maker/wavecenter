/**
 * Members' votes on what each action is worth, kept in memory for core's
 * tests. One `MemoryScoringRuleVoteStore` holds every member's votes;
 * `as(memberId)` is one member's `ScoringRuleVoteStore`, which, like the
 * table's row-level security, reads everyone's votes but writes only that
 * member's own. Like the table's foreign key, a vote on an action that has no
 * rule is refused. It never touches the rules or the ledger: a vote changes
 * no points (core/game.ts, `castScoringRuleVote`).
 */
import type { ScoringRule, ScoringRuleVote, ScoringRuleVoteStore } from './game.ts';

export class MemoryScoringRuleVoteStore {
  readonly rows = new Map<string, ScoringRuleVote>();
  private readonly rules: () => Promise<ScoringRule[]>;

  /** `rules` is where the scoring rules live, such as a MemoryEngagementStore. */
  constructor(rules: { rules(): Promise<ScoringRule[]> }) {
    this.rules = () => rules.rules();
  }

  /** One member's view: everyone's votes to read, only their own to write. */
  as(memberId: string): ScoringRuleVoteStore {
    const key = (kind: string) => `${kind}:${memberId}`;
    return {
      rules: () => this.rules(),
      all: async () => [...this.rows.values()].map((v) => ({ ...v })),
      mine: async (kind) => {
        const vote = this.rows.get(key(kind));
        return vote ? { ...vote } : null;
      },
      save: async (kind, points, tool) => {
        if (!(await this.rules()).some((r) => r.kind === kind)) throw new Error(`no scoring rule ${kind} to vote on`);
        const now = new Date().toISOString();
        const before = this.rows.get(key(kind));
        const vote: ScoringRuleVote = { kind, memberId, points, tool, createdAt: before?.createdAt ?? now, updatedAt: now };
        this.rows.set(key(kind), vote);
        return { ...vote };
      },
      remove: async (kind) => this.rows.delete(key(kind)),
    };
  }
}
