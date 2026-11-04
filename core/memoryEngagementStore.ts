/**
 * The engagement ledger kept in memory, for core's tests. It starts with
 * WaveCenter's starting scoring rules, and it can be told to fail so the
 * tests can check that a change whose engagement cannot be written is not
 * saved either (what the database's trigger does, in one transaction).
 * It also holds the rules for `changeScoringRule` and `addScoringRule`; like
 * the database's functions it writes what it is given, and the rules about
 * who may are core's. Like the rules table's score triggers, adding a rule,
 * or an update that changes its wording or points, is scored for `signedIn`,
 * the member the database would see as signed in. It is also a
 * `RescoreStore`: like the database's `apply_rescore`, it works the
 * corrections out itself (`rescoreCorrections`) and adds them all at once,
 * refusing when scoring is no longer provisional.
 */
import {
  NO_REASONS, RESCORE_TOOL, STARTING_SCORING_RULES, recordEngagement, rescoreCorrections, totalPoints, type Engagement, type EngagementLedger, type EngagementStore,
  type NewEngagementRow, type FactorReasons, type RescoreResult, type RescoreStore, type RescoreTally, type RuleFields, type ScoringFactors, type ScoringRule,
  type ScoringRuleStore,
} from './game.ts';

export class MemoryEngagementStore implements EngagementStore, ScoringRuleStore, RescoreStore {
  readonly rows: Engagement[] = [];
  ruleList: ScoringRule[] = STARTING_SCORING_RULES.map((r) => ({ ...r }));
  /** Set to make every insert fail. */
  failInsert = false;
  /** Set to make the next rule save write nothing, the way a refused write does. */
  failNextRuleSave = false;
  /** The tool that last changed each rule. */
  readonly ruleTools = new Map<string, string>();
  /** Who the database would see as signed in: the admin credited for adding or changing a rule. */
  signedIn: string | null = null;
  /** `game_settings.scoring_provisional`. */
  scoringProvisional = true;
  /** Set to make the next rescore fail, writing nothing. */
  failNextRescore = false;
  /** Members' public names, as the preview shows them. */
  readonly memberNames = new Map<string, string>();
  /** Each rescore that saved, as the `rescores` table keeps them. */
  readonly rescores: { id: string; tool: string; rows: number; points: number }[] = [];
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
    const was = this.ruleList[at];
    const changed = (['name', 'description', 'criteria', 'points'] as const).some((f) => was[f] !== fields[f]);
    // Score first: if that fails, the rule is not changed either, as in one transaction.
    if (changed && this.signedIn) {
      await recordEngagement(this, { memberId: this.signedIn, kind: 'changed_a_scoring_rule', tool });
    }
    this.ruleList[at] = { ...this.ruleList[at], ...fields };
    this.ruleTools.set(kind, tool);
    return { ...this.ruleList[at] };
  }

  async add(kind: string, fields: RuleFields, tool: string, factors?: ScoringFactors | null, reasons?: FactorReasons): Promise<ScoringRule | null> {
    if (this.failNextRuleSave) {
      this.failNextRuleSave = false;
      return null;
    }
    const rule = { kind, ...fields, position: Math.max(0, ...this.ruleList.map((r) => r.position)) + 1, factors: factors ?? null, reasons: reasons ?? { ...NO_REASONS } };
    // Score first: if that fails, the rule is not added either, as in one transaction.
    if (this.signedIn) await recordEngagement(this, { memberId: this.signedIn, kind: 'added_a_scoring_action', tool });
    this.ruleList.push(rule);
    this.ruleTools.set(kind, tool);
    return { ...rule };
  }

  async setFactors(kind: string, factors: ScoringFactors | null, tool: string): Promise<ScoringRule | null> {
    if (this.failNextRuleSave) {
      this.failNextRuleSave = false;
      return null;
    }
    const at = this.ruleList.findIndex((r) => r.kind === kind);
    if (at < 0) return null;
    this.ruleList[at] = { ...this.ruleList[at], factors };
    this.ruleTools.set(kind, tool);
    return { ...this.ruleList[at] };
  }

  async setReasons(kind: string, reasons: FactorReasons, tool: string): Promise<ScoringRule | null> {
    if (this.failNextRuleSave) {
      this.failNextRuleSave = false;
      return null;
    }
    const at = this.ruleList.findIndex((r) => r.kind === kind);
    if (at < 0) return null;
    this.ruleList[at] = { ...this.ruleList[at], reasons };
    this.ruleTools.set(kind, tool);
    return { ...this.ruleList[at] };
  }

  async insert(row: NewEngagementRow): Promise<Engagement> {
    if (this.failInsert) throw new Error('the ledger is down');
    const engagement: Engagement = { ...row, id: `engagement-${this.next++}`, createdAt: new Date().toISOString() };
    this.rows.push(engagement);
    return { ...engagement };
  }

  async provisional(): Promise<boolean> {
    return this.scoringProvisional;
  }

  async tallies(): Promise<RescoreTally[]> {
    const byKey = new Map<string, RescoreTally>();
    for (const e of this.rows) {
      const key = `${e.memberId} ${e.kind}`;
      const t = byKey.get(key) ?? { memberId: e.memberId, memberName: this.memberNames.get(e.memberId) ?? null, kind: e.kind, actions: 0, credited: 0 };
      if (!e.rescoreId) t.actions += 1;
      t.credited += e.points;
      byKey.set(key, t);
    }
    return [...byKey.values()];
  }

  async apply(kinds: readonly string[], tool: string): Promise<RescoreResult> {
    if (this.failNextRescore) {
      this.failNextRescore = false;
      throw new Error('The rescore did not save. No points changed; try again.');
    }
    if (!this.scoringProvisional) throw new Error('Points are final for this DEO, so past points can no longer be rescored. Nothing was saved.');
    const corrections = rescoreCorrections(await this.rules(), await this.tallies(), kinds);
    if (!corrections.length) return { rescoreId: null, rows: 0, points: 0 };
    const rescoreId = `rescore-${this.next++}`;
    for (const c of corrections) {
      await this.insert({ memberId: c.memberId, kind: c.kind as Engagement['kind'], points: c.points, tool: RESCORE_TOOL, taskId: null, rescoreId });
    }
    const saved = { rescoreId, rows: corrections.length, points: corrections.reduce((n, c) => n + c.points, 0) };
    this.rescores.push({ id: rescoreId, tool, rows: saved.rows, points: saved.points });
    return saved;
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
