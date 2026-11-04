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
 * (supabase/migrations/20261102180000_scoring_factors.sql). Each rule also
 * carries why it got each factor score
 * (supabase/migrations/20261103120000_scoring_factor_reasons.sql), which
 * `set_scoring_factor_reasons` changes and `add_scoring_rule` also takes
 * (supabase/migrations/20261103140000_edit_factor_reasons.sql).
 *
 * `supabaseRescoreStore` is the `RescoreStore` the Admin page's "Rescore
 * past points" uses. Its preview reads `rescore_tallies` and its rescore
 * calls `apply_rescore`; both refuse any role without "Manage game scoring",
 * and `apply_rescore` refuses once scoring is no longer provisional
 * (supabase/migrations/20261103160000_rescore_past_points.sql).
 */
import type {
  Engagement, EngagementLedger, FactorReasons, RescoreStore, ScoringFactors, ScoringPhase, ScoringPhaseStore, ScoringRule, ScoringRuleStore,
} from "../../core/game.ts";
import type { Earning, TokenSize } from "../../core/tokens.ts";
import { CoreError } from "../../core/tool.ts";
import type { supabaseForRequest } from "./supabase";
import { listTokenSizes } from "./tokenStore";

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
    reasons: {
      effort: row.effort_reason ?? null,
      value: row.value_reason ?? null,
      rarity: row.rarity_reason ?? null,
      farmRisk: row.farm_risk_reason ?? null,
    },
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

function reasonParams(reasons: FactorReasons | null | undefined) {
  return {
    new_effort_reason: reasons?.effort ?? null,
    new_value_reason: reasons?.value ?? null,
    new_rarity_reason: reasons?.rarity ?? null,
    new_farm_risk_reason: reasons?.farmRisk ?? null,
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
    rescoreId: row.rescore_id ?? null,
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
    add: (kind, fields, tool, factors, reasons) =>
      call("add_scoring_rule", { new_kind: kind, ...wording(fields, tool), ...factorParams(factors), ...reasonParams(reasons) }),
    setFactors: (kind, factors, tool) => call("set_scoring_factors", { rule_kind: kind, ...factorParams(factors), tool }),
    setReasons: (kind, reasons, tool) => call("set_scoring_factor_reasons", { rule_kind: kind, ...reasonParams(reasons), tool }),
  };
}

export function supabaseRescoreStore(supabase: Client): RescoreStore {
  return {
    async rules() {
      const { data, error } = await supabase.from("game_scoring_rules").select().order("position");
      if (error) failed("the scoring rules", error);
      return (data ?? []).map(ruleFromRow);
    },
    async provisional() {
      const { data, error } = await supabase.from("game_settings").select("scoring_provisional").maybeSingle();
      if (error) failed("whether scoring is provisional", error);
      // No settings row means the rescore migration has not been applied: say so, never guess.
      if (!data) throw new Error("The game settings are missing, so WaveCenter cannot tell whether points are final. The rescore migration has not been applied.");
      return data.scoring_provisional === true;
    },
    async tallies() {
      // One row per member per action, and the API hands back at most 1,000
      // rows a call (supabase/config.toml max_rows): page until a page comes
      // back empty, so a large DEO is never cut short silently.
      const rows: any[] = [];
      for (;;) {
        const { data, error } = await supabase
          .rpc("rescore_tallies")
          .order("member_id")
          .order("kind")
          .range(rows.length, rows.length + 999);
        if (error) failed("every member's points", error);
        if (!data?.length) break;
        rows.push(...(data as any[]));
      }
      return rows.map((r) => ({
        memberId: r.member_id,
        memberName: r.member_name ?? null,
        kind: r.kind,
        actions: Number(r.actions),
        credited: Number(r.credited),
      }));
    },
    async apply(kinds, tool) {
      const { data, error } = await supabase.rpc("apply_rescore", { rescore_kinds: kinds, tool });
      if (error) throw new Error(`The database refused to rescore: ${error.message}`);
      // It may have saved: never say it did not (engineering rule 6).
      if (!data || typeof data !== "object" || !("rows" in data)) {
        throw new CoreError("The database's reply could not be read, so WaveCenter cannot tell whether the rescore saved. Reload the page and click Preview to see what saved.");
      }
      const saved = data as { rescore_id: string | null; rows: number; points: number };
      return { rescoreId: saved.rescore_id, rows: Number(saved.rows), points: Number(saved.points) };
    },
  };
}

function phaseFromRow(row: any): ScoringPhase {
  return {
    provisional: row.provisional === true,
    finalAt: row.final_at ?? null,
    finalBy: row.final_by ?? null,
    finalByName: row.final_by_name ?? null,
  };
}

/** Whether points are provisional or final (core/game.ts `makeScoringFinal`), and the switch that ends the provisional phase. */
export function supabaseScoringPhaseStore(supabase: Client): ScoringPhaseStore {
  return {
    async phase() {
      const { data, error } = await supabase.rpc("scoring_phase").maybeSingle();
      if (error) failed("whether points are final", error);
      // No row means a migration has not been applied: say so, never guess.
      if (!data) throw new Error("The game settings are missing, so WaveCenter cannot tell whether points are final. The scoring migrations have not been applied.");
      return phaseFromRow(data);
    },
    async makeFinal(tool) {
      const { data, error } = await supabase.rpc("make_scoring_final", { tool });
      if (error) throw new Error(`The database refused to make points final: ${error.message}`);
      // It may have saved: never say it did not (engineering rule 6).
      if (!data || typeof data !== "object" || !("provisional" in data)) {
        throw new CoreError("The database's reply could not be read, so WaveCenter cannot tell whether points are final now. Reload the page to see.");
      }
      return phaseFromRow(data);
    },
  };
}

/**
 * What the header needs to play the tokens a member has earned since their
 * browser last showed them (core/tokens.ts `tokensToPlay`): who they are (the
 * browser remembers per member), their newest earnings, and the token sizes.
 * Null when either could not be read: then nothing plays and the plain total
 * shows, so a failed read never breaks the page.
 */
export type HeaderCatchUp = { memberId: string; recent: Earning[]; sizes: Pick<TokenSize, "diameter" | "color" | "minPoints">[] } | null;

/** The header's point total: the number, or why it could not be read, and what to play since the last visit. */
export type HeaderPoints = ({ value: number; error: null } | { value: null; error: string }) & { catchUp?: HeaderCatchUp };

/** How many of the newest engagements the header reads to find what is new. */
const CATCH_UP_READ = 50;

/** For the header: the member's newest earnings and the token sizes, or null if either could not be read. */
export async function headerCatchUp(supabase: Client, memberId: string): Promise<HeaderCatchUp> {
  try {
    const [latest, sizes] = await Promise.all([supabaseEngagementLedger(supabase, memberId).latest(CATCH_UP_READ), listTokenSizes(supabase)]);
    return {
      memberId,
      recent: latest.map((e) => ({ id: e.id, points: e.points, createdAt: e.createdAt })),
      sizes: sizes.map((s) => ({ diameter: s.diameter, color: s.color, minPoints: s.minPoints })),
    };
  } catch {
    return null;
  }
}

/**
 * For the header: the signed-in member's point total, the same one My Points
 * shows, and what to play since their last visit. A failed read never becomes
 * 0; it comes back as the reason, so the header can say the total could not
 * be loaded (engineering rule 6).
 */
export async function headerPoints(supabase: Client, memberId: string): Promise<HeaderPoints> {
  const catchUp = headerCatchUp(supabase, memberId);
  try {
    return { value: await supabaseEngagementLedger(supabase, memberId).total(), error: null, catchUp: await catchUp };
  } catch (err) {
    await catchUp;
    return { value: null, error: err instanceof Error ? err.message : String(err), catchUp: null };
  }
}
