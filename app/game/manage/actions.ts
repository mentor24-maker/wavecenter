"use server";

/**
 * Changing the scoring rules, run on the server through core
 * (changeScoringRule, addScoringRule) as the tool `wavecenter`. The database's
 * own functions check the same permission again.
 *
 * Returns `{ ok: true, rule }` only after the database confirmed the save.
 * Anything else comes back as `{ ok: false, error }` in plain words, and the
 * screen shows it without calling anything saved (engineering rule 6).
 */
import { revalidatePath } from "next/cache";
import { addScoringRule, changeScoringRule, type GameActor, type ScoringRule } from "../../../core/game.ts";
import { CoreError, WAVECENTER_TOOL } from "../../../core/tool.ts";
import { supabaseScoringRuleStore } from "../../lib/engagementStore";
import { myRole, readRolesAndPermissions } from "../../lib/memberRoleStore";
import { currentUser, supabaseForRequest } from "../../lib/supabase";

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

async function asManager(
  act: (store: ReturnType<typeof supabaseScoringRuleStore>, actor: GameActor) => Promise<ScoringRule>,
): Promise<RuleSaveResult> {
  let rule: ScoringRule;
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
    rule = await act(supabaseScoringRuleStore(supabase), { role, grants: lists.grants });
  } catch (err) {
    if (err instanceof CoreError) return { ok: false, error: err.message };
    console.error("game: could not save a scoring rule:", err);
    return { ok: false, error: `Nothing was saved. ${err instanceof Error ? err.message : String(err)}` };
  }
  revalidatePath("/game");
  revalidatePath("/game/manage");
  return { ok: true, rule };
}

export async function saveScoringRule(kind: string, form: RuleForm): Promise<RuleSaveResult> {
  return asManager(async (store, actor) => (await changeScoringRule(store, actor, { kind, ...fields(form) }, WAVECENTER_TOOL)).after);
}

export async function addScoringAction(form: RuleForm): Promise<RuleSaveResult> {
  return asManager((store, actor) => addScoringRule(store, actor, fields(form), WAVECENTER_TOOL));
}
