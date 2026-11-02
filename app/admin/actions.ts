"use server";

/**
 * The Admin page's batch job: work out every action's points by formula
 * (core/game.ts `recalculateGranularPoints`), then, only when the admin
 * accepts, put the changed values live (`applyGranularPoints`, which saves
 * each row through the same `changeScoringRule` as Game → Manage). Both run
 * on the server as the tool `wavecenter`; core refuses anyone without
 * "Manage game scoring", and the database's `update_scoring_rule` checks the
 * same permission again, so calling either action directly does not get
 * round the screen.
 *
 * A failure comes back as `{ ok: false, error }` in plain words; putting the
 * values live reports each row that saved and each that did not, and why
 * (engineering rule 6).
 */
import { revalidatePath } from "next/cache";
import {
  applyGranularPoints,
  recalculateGranularPoints,
  type AcceptedProposal,
  type GameActor,
  type GranularApplyResult,
  type GranularProposal,
} from "../../core/game.ts";
import { CoreError, WAVECENTER_TOOL } from "../../core/tool.ts";
import { supabaseScoringRuleStore } from "../lib/engagementStore";
import { myRole, readRolesAndPermissions } from "../lib/memberRoleStore";
import { currentUser, supabaseForRequest } from "../lib/supabase";

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

async function asAdmin<T>(
  what: string,
  act: (store: ReturnType<typeof supabaseScoringRuleStore>, actor: GameActor) => Promise<T>,
): Promise<Result<T>> {
  try {
    const supabase = await supabaseForRequest();
    if (!supabase) return { ok: false, error: `This copy of WaveCenter has no database settings, so ${what}.` };
    const { user, checkFailed } = await currentUser(supabase);
    if (!user) {
      return {
        ok: false,
        error: checkFailed
          ? `WaveCenter could not check that you are signed in, so ${what}. Try again in a minute.`
          : `You are signed out, so ${what}. Reload the page and log in again.`,
      };
    }
    const [role, lists] = await Promise.all([myRole(supabase, user.id), readRolesAndPermissions(supabase)]);
    return { ok: true, value: await act(supabaseScoringRuleStore(supabase), { role, grants: lists.grants }) };
  } catch (err) {
    if (err instanceof CoreError) return { ok: false, error: err.message };
    console.error(`admin: ${what}:`, err);
    return { ok: false, error: `${what[0].toUpperCase()}${what.slice(1)}. ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Work out every action's points by formula. Saves nothing. */
export async function recalculateActionPoints(): Promise<Result<GranularProposal[]>> {
  return asAdmin("nothing was recalculated", (store, actor) => recalculateGranularPoints(store, actor));
}

/** Save the rows the admin was shown and accepted. Each row saves or fails on its own. */
export async function putActionPointsLive(accepted: AcceptedProposal[]): Promise<Result<GranularApplyResult>> {
  const result = await asAdmin("nothing was saved", (store, actor) => applyGranularPoints(store, actor, accepted, WAVECENTER_TOOL));
  if (result.ok && result.value.saved.length) {
    revalidatePath("/game");
    revalidatePath("/game/manage");
  }
  return result;
}
