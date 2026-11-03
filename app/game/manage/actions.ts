"use server";

/**
 * Changing the scoring rules (changeScoringRule, addScoringRule,
 * changeScoringFactors, changeFactorReasons) and the token sizes
 * (addTokenSize, changeTokenSize, removeTokenSize), run on the server through
 * core as the tool `wavecenter`. The database's own functions and row-level
 * security check the same permission again.
 *
 * Returns `{ ok: true, ... }` only after the database confirmed the save.
 * Anything else comes back as `{ ok: false, error }` in plain words, and the
 * screen shows it without calling anything saved (engineering rule 6).
 */
import { revalidatePath } from "next/cache";
import { addScoringRule, changeFactorReasons, changeScoringFactors, changeScoringRule, type FactorKey, type GameActor, type ScoringRule } from "../../../core/game.ts";
import { CoreError, WAVECENTER_TOOL } from "../../../core/tool.ts";
import { addTokenSize, changeTokenSize, removeTokenSize, type TokenSize } from "../../../core/tokens.ts";
import { supabaseScoringRuleStore } from "../../lib/engagementStore";
import { myRole, readRolesAndPermissions } from "../../lib/memberRoleStore";
import { currentUser, supabaseForRequest } from "../../lib/supabase";
import { supabaseTokenStore } from "../../lib/tokenStore";

export type RuleSaveResult = { ok: true; rule: ScoringRule } | { ok: false; error: string };

export interface RuleForm {
  name: string;
  description: string;
  criteria: string;
  /** As typed. A number-looking value becomes a number; anything else is left for core to refuse. */
  points: string;
}

function fields(form: RuleForm) {
  const typed = String(form.points ?? "").trim();
  return { ...form, points: /^-?\d+(\.\d+)?$/.test(typed) ? Number(typed) : typed };
}

type Client = NonNullable<Awaited<ReturnType<typeof supabaseForRequest>>>;
type Done<T> = { ok: true; value: T } | { ok: false; error: string };

/** Run one change as the signed-in member, with their role and the grants the database holds. */
async function asGameManager<T>(what: string, act: (supabase: Client, actor: GameActor) => Promise<T>): Promise<Done<T>> {
  let value: T;
  try {
    const supabase = await supabaseForRequest();
    if (!supabase) return { ok: false, error: "This copy of WaveCenter has no database settings, so nothing can be saved." };
    const { user, checkFailed } = await currentUser(supabase);
    if (!user) {
      return {
        ok: false,
        error: checkFailed
          ? "WaveCenter could not check that you are signed in, so nothing was saved. Try again in a minute."
          : "You are signed out, so nothing was saved. Reload the page and log in again.",
      };
    }
    const [role, lists] = await Promise.all([myRole(supabase, user.id), readRolesAndPermissions(supabase)]);
    value = await act(supabase, { role, grants: lists.grants });
  } catch (err) {
    if (err instanceof CoreError) return { ok: false, error: err.message };
    console.error(`game: could not save ${what}:`, err);
    return { ok: false, error: `Nothing was saved. ${err instanceof Error ? err.message : String(err)}` };
  }
  revalidatePath("/game");
  revalidatePath("/game/manage");
  return { ok: true, value };
}

async function asManager(
  act: (store: ReturnType<typeof supabaseScoringRuleStore>, actor: GameActor) => Promise<ScoringRule>,
): Promise<RuleSaveResult> {
  const done = await asGameManager("a scoring rule", (supabase, actor) => act(supabaseScoringRuleStore(supabase), actor));
  return done.ok ? { ok: true, rule: done.value } : done;
}

export async function saveScoringRule(kind: string, form: RuleForm): Promise<RuleSaveResult> {
  return asManager(async (store, actor) => (await changeScoringRule(store, actor, { kind, ...fields(form) }, WAVECENTER_TOOL)).after);
}

/** The four factor dropdowns as chosen ('' for not chosen), or null for none. Core checks them. */
export type FactorsForm = Record<"effort" | "value" | "rarity" | "farmRisk", string> | null;

/** The four reasons as typed ('' for none). Core trims and checks them. */
export type ReasonsForm = Record<FactorKey, string> | null;

export async function addScoringAction(form: RuleForm, factors: FactorsForm = null, reasons: ReasonsForm = null): Promise<RuleSaveResult> {
  return asManager((store, actor) => addScoringRule(store, actor, { ...fields(form), factors, reasons }, WAVECENTER_TOOL));
}

/** Save an action's four factors. Its points do not change until the Admin page's batch is put live. */
export async function saveScoringFactors(kind: string, factors: FactorsForm): Promise<RuleSaveResult> {
  return asManager((store, actor) => changeScoringFactors(store, actor, { kind, factors }, WAVECENTER_TOOL));
}

/** Save why an action got one factor score. The other three keep theirs; a blank one is cleared. */
export async function saveFactorReason(kind: string, factor: FactorKey, reason: string): Promise<RuleSaveResult> {
  return asManager((store, actor) => changeFactorReasons(store, actor, { kind, reasons: { [factor]: reason } }, WAVECENTER_TOOL));
}

export type TokenSaveResult = { ok: true; size: TokenSize } | { ok: false; error: string };

/** A token size as typed. Core turns the numbers from text and checks every field. */
export interface TokenForm {
  name: string;
  diameter: string;
  color: string;
  minPoints: string;
}

/** Add a token size (`id` null) or change one. */
export async function saveTokenSize(id: string | null, form: TokenForm): Promise<TokenSaveResult> {
  const done = await asGameManager("a token size", (supabase, actor) =>
    id === null
      ? addTokenSize(supabaseTokenStore(supabase), actor, form, WAVECENTER_TOOL)
      : changeTokenSize(supabaseTokenStore(supabase), actor, id, form, WAVECENTER_TOOL),
  );
  return done.ok ? { ok: true, size: done.value } : done;
}

export async function deleteTokenSize(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const done = await asGameManager("a token size", (supabase, actor) => removeTokenSize(supabaseTokenStore(supabase), actor, id, WAVECENTER_TOOL));
  return done.ok ? { ok: true } : done;
}
