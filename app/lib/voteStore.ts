/**
 * The app's `VoteStore` (core/votes.ts): how core reaches the `task_votes`
 * table. Like app/lib/taskStore.ts it acts through the signed-in member's own
 * session, so row-level security lets it read every vote and write only the
 * member's own. It only translates names and turns a failed call into a
 * thrown error; the database applies the average to the task itself.
 */
import type { Vote, VoteStore } from "../../core/votes.ts";
import type { supabaseForRequest } from "./supabase";
import { TOOL_HEADER } from "./taskStore";

type Client = NonNullable<Awaited<ReturnType<typeof supabaseForRequest>>>;

export function voteFromRow(row: any): Vote {
  return {
    taskId: row.task_id,
    memberId: row.member_id,
    points: row.points,
    priority: row.priority,
    tool: row.tool,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function failed(what: string, error: { message: string }): never {
  throw new Error(`The database refused to ${what}: ${error.message}`);
}

export function supabaseVoteStore(supabase: Client, memberId: string): VoteStore {
  return {
    async mine(taskId) {
      const { data, error } = await supabase.from("task_votes").select().eq("task_id", taskId).eq("member_id", memberId).maybeSingle();
      if (error) failed("read your vote", error);
      return data ? voteFromRow(data) : null;
    },
    async forTask(taskId) {
      const { data, error } = await supabase.from("task_votes").select().eq("task_id", taskId);
      if (error) failed("read the task's votes", error);
      return (data ?? []).map(voteFromRow);
    },
    async save(row) {
      const { data, error } = await supabase
        .from("task_votes")
        .upsert(
          { task_id: row.taskId, member_id: memberId, points: row.points, priority: row.priority, tool: row.tool },
          { onConflict: "task_id,member_id" },
        )
        .select()
        .single();
      if (error) failed("save your vote", error);
      return voteFromRow(data);
    },
    async remove(taskId, tool) {
      const { data, error } = await supabase
        .from("task_votes")
        .delete()
        .eq("task_id", taskId)
        .eq("member_id", memberId)
        .select("task_id")
        .setHeader(TOOL_HEADER, tool);
      if (error) failed("withdraw your vote", error);
      return (data?.length ?? 0) > 0;
    },
  };
}
