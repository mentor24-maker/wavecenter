"use server";

/**
 * Members' votes on what each action is worth, from the Game page's "How
 * points are earned" table: cast, change or withdraw the signed-in member's
 * own vote through core (`castScoringRuleVote`) as the tool `wavecenter`,
 * signed in as the member (never the service key), so row-level security
 * lets them write only their own vote.
 *
 * Returns `{ ok: true, ... }` only after the database confirmed the save.
 * Anything else comes back as `{ ok: false, error }` in plain words, and the
 * screen says the vote was not saved (engineering rule 6).
 */
import { revalidatePath } from "next/cache";
import { castScoringRuleVote, summarizeScoringRuleVotes, type ScoringRuleVoteSummary } from "../../core/game.ts";
import { CoreError, WAVECENTER_TOOL } from "../../core/tool.ts";
import { supabaseScoringRuleVoteStore } from "../lib/scoringRuleVoteStore";
import { currentUser, supabaseForRequest } from "../lib/supabase";

export type RuleVoteResult = { ok: true; summary: ScoringRuleVoteSummary } | { ok: false; error: string };

/**
 * `typed` is the box as typed; an empty or null one withdraws the vote. A
 * number-looking value becomes a number; anything else is left for core to
 * refuse in plain words.
 */
export async function voteOnRule(kind: string, typed: string | null): Promise<RuleVoteResult> {
  const text = typed === null ? "" : String(typed).trim();
  const points = text === "" ? null : /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : text;
  let summary: ScoringRuleVoteSummary;
  try {
    const supabase = await supabaseForRequest();
    if (!supabase) return { ok: false, error: "This copy of WaveCenter has no database settings, so nothing can be saved." };
    const { user, checkFailed } = await currentUser(supabase);
    if (!user) {
      return {
        ok: false,
        error: checkFailed
          ? "WaveCenter could not check that you are signed in, so your vote was not saved. Try again in a minute."
          : "You are signed out, so your vote was not saved. Reload the page and log in again.",
      };
    }
    const store = supabaseScoringRuleVoteStore(supabase, user.id);
    await castScoringRuleVote(store, kind, points, WAVECENTER_TOOL);
    summary = summarizeScoringRuleVotes(await store.all(), user.id).get(kind) ?? { average: null, voters: 0, mine: null };
  } catch (err) {
    if (err instanceof CoreError) return { ok: false, error: err.message };
    console.error("game: could not save a vote on a scoring rule:", err);
    return { ok: false, error: "Your vote was not saved: the database could not be reached or refused it. Try again." };
  }
  revalidatePath("/game");
  return { ok: true, summary };
}
