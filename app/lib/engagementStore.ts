/**
 * The app's `EngagementLedger` (core/game.ts): how the Game page reads the
 * scoring rules and the signed-in member's own engagements. It acts through
 * the member's session, so row-level security keeps it to their rows.
 *
 * The ledger only reads. Engagements are written by the database itself,
 * inside the same save as each change
 * (supabase/migrations/20261027120000_game_layer.sql), so there is nothing
 * here that writes one, and nothing a page could forge.
 *
 * `supabaseScoringRuleStore` is the `ScoringRuleStore` the Game management
 * screen changes rules through. It calls the database's `update_scoring_rule`
 * and `add_scoring_rule`, which refuse any role without "Manage game scoring"
 * (supabase/migrations/20261031140000_game_scoring_admin.sql), and
 * `set_scoring_factors` for an action's four factor scores
 * (supabase/migrations/20261102180000_scoring_factors.sql).
 */
import type { Engagement, EngagementLedger, ScoringFactors, ScoringRule, ScoringRuleStore } from "../../core/game.ts";
import type { supabaseForRequest } from "./supabase";

type Client = NonNullable<Awaited<ReturnType<typeof supabaseForRequest>>>;

export function ruleFromRow(row: any): ScoringRule {
  return {
    kind: row.kind,
    name: row.name,
    description: row.description,
    criteria: row.criteria,
    points: row.points,
    position: row.position,
    factors: factorsFromRow(row),
  };
}

/** A row's four factors, or null when it is not scored yet. */
function factorsFromRow(row: any): ScoringFactors | null {
  if ([row.effort, row.value, row.rarity, row.farm_risk].some((v) => v == null)) return null;
  return { effort: row.effort, value: row.value, rarity: row.rarity, farmRisk: row.farm_risk };
}

function factorParams(factors: ScoringFactors | null | undefined) {
  return {
    new_effort: factors?.effort ?? null,
    new_value: factors?.value ?? null,
    new_rarity: factors?.rarity ?? null,
    new_farm_risk: factors?.farmRisk ?? null,
  };
}

export function engagementFromRow(row: any): Engagement {
  return {
    id: row.id,
    memberId: row.member_id,
    kind: row.kind,
    points: row.points,
    tool: row.tool,
    taskId: row.task_id,
    createdAt: row.created_at,
  };
}

function failed(what: string, error: { message: string }): never {
  throw new Error(`The database refused to read ${what}: ${error.message}`);
}

export function supabaseEngagementLedger(supabase: Client, memberId: string): EngagementLedger {
  return {
    async rules() {
      const { data, error } = await supabase.from("game_scoring_rules").select().order("position");
      if (error) failed("the scoring rules", error);
      return (data ?? []).map(ruleFromRow);
    },
    async latest(limit) {
      const { data, error } = await supabase
        .from("engagements")
        .select()
        .eq("member_id", memberId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) failed("your engagements", error);
      return (data ?? []).map(engagementFromRow);
    },
    async total() {
      const { data, error } = await supabase.from("engagement_totals").select("points").eq("member_id", memberId).maybeSingle();
      if (error) failed("your points total", error);
      // No row yet means no engagements yet: a total of zero, not an error.
      return Number(data?.points ?? 0);
    },
  };
}

export function supabaseScoringRuleStore(supabase: Client): ScoringRuleStore {
  const call = async (fn: string, params: Record<string, unknown>) => {
    const { data, error } = await supabase.rpc(fn, params);
    if (error) throw new Error(`The database refused to save the scoring rule: ${error.message}`);
    return data && typeof data === "object" && "kind" in data ? ruleFromRow(data) : null;
  };
  const wording = (fields: Parameters<ScoringRuleStore["update"]>[1], tool: string) => ({
    new_name: fields.name,
    new_description: fields.description,
    new_criteria: fields.criteria,
    new_points: fields.points,
    tool,
  });
  return {
    async rules() {
      const { data, error } = await supabase.from("game_scoring_rules").select().order("position");
      if (error) failed("the scoring rules", error);
      return (data ?? []).map(ruleFromRow);
    },
    update: (kind, fields, tool) => call("update_scoring_rule", { rule_kind: kind, ...wording(fields, tool) }),
    add: (kind, fields, tool, factors) => call("add_scoring_rule", { new_kind: kind, ...wording(fields, tool), ...factorParams(factors) }),
    setFactors: (kind, factors, tool) => call("set_scoring_factors", { rule_kind: kind, ...factorParams(factors), tool }),
  };
}
