/**
 * The app's `ScoringRuleVoteStore` (core/game.ts): how core reaches the
 * `scoring_rule_votes` table, members' votes on what each action is worth.
 * Like app/lib/voteStore.ts it acts through the signed-in member's own
 * session, so row-level security lets it read every vote and write only the
 * member's own. It only translates names and turns a failed call into a
 * thrown error; the rules are core's.
 */
import type { ScoringRuleVote, ScoringRuleVoteStore } from "../../core/game.ts";
import { ruleFromRow } from "./engagementStore";
import type { supabaseForRequest } from "./supabase";

type Client = NonNullable<Awaited<ReturnType<typeof supabaseForRequest>>>;

export function scoringRuleVoteFromRow(row: any): ScoringRuleVote {
  return {
    kind: row.kind,
    memberId: row.member_id,
    points: row.points,
    tool: row.tool,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function failed(what: string, error: { message: string }): never {
  throw new Error(`The database refused to ${what}: ${error.message}`);
}

export function supabaseScoringRuleVoteStore(supabase: Client, memberId: string): ScoringRuleVoteStore {
  return {
    async rules() {
      const { data, error } = await supabase.from("game_scoring_rules").select().order("position");
      if (error) failed("read the scoring rules", error);
      return (data ?? []).map(ruleFromRow);
    },
    async all() {
      const { data, error } = await supabase.from("scoring_rule_votes").select();
      if (error) failed("read the members' votes", error);
      return (data ?? []).map(scoringRuleVoteFromRow);
    },
    async mine(kind) {
      const { data, error } = await supabase.from("scoring_rule_votes").select().eq("kind", kind).eq("member_id", memberId).maybeSingle();
      if (error) failed("read your vote", error);
      return data ? scoringRuleVoteFromRow(data) : null;
    },
    async save(kind, points, tool) {
      const { data, error } = await supabase
        .from("scoring_rule_votes")
        .upsert({ kind, member_id: memberId, points, tool }, { onConflict: "kind,member_id" })
        .select()
        .single();
      if (error) failed("save your vote", error);
      return scoringRuleVoteFromRow(data);
    },
    async remove(kind) {
      const { data, error } = await supabase
        .from("scoring_rule_votes")
        .delete()
        .eq("kind", kind)
        .eq("member_id", memberId)
        .select("kind");
      if (error) failed("withdraw your vote", error);
      return (data?.length ?? 0) > 0;
    },
  };
}
