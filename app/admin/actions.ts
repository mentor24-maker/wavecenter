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
 *
 * "Rescore past points" works the same way: `previewRescoreAction` saves
 * nothing, and `rescoreAction` adds the correction rows (core/game.ts
 * `applyRescore`), which the database's `apply_rescore` checks again: an
 * admin only, and only while scoring is provisional.
 *
 * "Make points final" (`makeScoringFinalAction`) ends the provisional phase
 * for good (core/game.ts `makeScoringFinal`, with FINAL typed to confirm);
 * the database's `make_scoring_final` checks the permission again, and its
 * trigger refuses any change back.
 *
 * "AI task ratings" (`rateTasksAction`) asks the AI to rate the open tasks
 * that need it (core/aiTaskRater.ts `rateTasks`, which refuses anyone without
 * "Manage game scoring"), and saves each pass with the service key. It says
 * which tasks it rated and which it could not, and why; a task it could not
 * rate has nothing saved.
 */
import { revalidatePath } from "next/cache";
import {
  applyGranularPoints,
  applyRescore,
  makeScoringFinal,
  previewRescore,
  recalculateGranularPoints,
  type AcceptedProposal,
  type GameActor,
  type GranularApplyResult,
  type GranularProposal,
  type RescorePreview,
  type RescoreResult,
  type ScoringPhase,
} from "../../core/game.ts";
import { AI_RATING_TOOL, rateTasks, type RatingRunResult } from "../../core/aiTaskRater.ts";
import { CoreError, WAVECENTER_TOOL } from "../../core/tool.ts";
import { claudeTaskRater, missingRatingSettings, readRatingInputs, supabaseAiTaskRatingStore } from "../lib/aiTaskRating";
import { supabaseRescoreStore, supabaseScoringPhaseStore, supabaseScoringRuleStore } from "../lib/engagementStore";
import { myRole, readRolesAndPermissions } from "../lib/memberRoleStore";
import { currentUser, supabaseForRequest } from "../lib/supabase";

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

type Client = NonNullable<Awaited<ReturnType<typeof supabaseForRequest>>>;

async function asAdmin<T>(what: string, act: (supabase: Client, actor: GameActor) => Promise<T>): Promise<Result<T>> {
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
    return { ok: true, value: await act(supabase, { role, grants: lists.grants }) };
  } catch (err) {
    if (err instanceof CoreError) return { ok: false, error: err.message };
    console.error(`admin: ${what}:`, err);
    return { ok: false, error: `${what[0].toUpperCase()}${what.slice(1)}. ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Work out every action's points by formula. Saves nothing. */
export async function recalculateActionPoints(): Promise<Result<GranularProposal[]>> {
  return asAdmin("nothing was recalculated", (supabase, actor) => recalculateGranularPoints(supabaseScoringRuleStore(supabase), actor));
}

/** Save the rows the admin was shown and accepted. Each row saves or fails on its own. */
export async function putActionPointsLive(accepted: AcceptedProposal[]): Promise<Result<GranularApplyResult>> {
  const result = await asAdmin("nothing was saved", (supabase, actor) =>
    applyGranularPoints(supabaseScoringRuleStore(supabase), actor, accepted, WAVECENTER_TOOL),
  );
  if (result.ok && result.value.saved.length) {
    revalidatePath("/game");
    revalidatePath("/game/manage");
  }
  return result;
}

/** Show what rescoring past points to today's values would do. Saves nothing. */
export async function previewRescoreAction(): Promise<Result<RescorePreview>> {
  return asAdmin("nothing was worked out", (supabase, actor) => previewRescore(supabaseRescoreStore(supabase), actor));
}

/** Rescore the ticked actions' past points. All of them save together, or none do. */
export async function rescoreAction(kinds: string[]): Promise<Result<RescoreResult>> {
  const result = await asAdmin("no points changed", (supabase, actor) => applyRescore(supabaseRescoreStore(supabase), actor, kinds, WAVECENTER_TOOL));
  if (result.ok && result.value.rows) {
    revalidatePath("/game");
    revalidatePath("/", "layout");
  }
  return result;
}

/** End the provisional phase, for good. Refused without FINAL typed, for anyone but an admin, and a second time. */
export async function makeScoringFinalAction(confirmation: string): Promise<Result<ScoringPhase>> {
  const result = await asAdmin("nothing was changed", (supabase, actor) =>
    makeScoringFinal(supabaseScoringPhaseStore(supabase), actor, confirmation, WAVECENTER_TOOL),
  );
  if (result.ok) {
    revalidatePath("/admin");
    revalidatePath("/game");
  }
  return result;
}

/** Ask the AI to rate the open tasks that need it, up to the per-run cap. Each task saves whole or not at all. */
export async function rateTasksAction(): Promise<Result<RatingRunResult>> {
  const missing = missingRatingSettings();
  if (missing.length) {
    return { ok: false, error: `This copy of WaveCenter is missing ${missing.join(" and ")}, so nothing was rated.` };
  }
  const rater = claudeTaskRater();
  if (!rater) return { ok: false, error: "This copy of WaveCenter has no AI key, so nothing was rated." };
  const result = await asAdmin("nothing was rated", async (supabase, actor) => {
    const inputs = await readRatingInputs(supabase);
    return rateTasks({ actor, ...inputs, store: supabaseAiTaskRatingStore(supabase), rater, tool: AI_RATING_TOOL });
  });
  if (result.ok) {
    for (const f of result.value.failed) console.error(`ai-rating: task ${f.taskId} was not rated: ${f.reason}`);
    if (result.value.rated.length) revalidatePath("/tasks", "layout");
  }
  return result;
}
