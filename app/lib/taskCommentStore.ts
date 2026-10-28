/**
 * The app's `TaskCommentStore` (core/comments.ts): how core reaches the
 * `task_comments` table. Like app/lib/taskStore.ts it acts through the
 * signed-in member's own session, so the table's own rules decide what it can
 * touch, and it only translates names and turns a failed call into a thrown
 * error.
 */
import type { NewTaskCommentRow, TaskComment, TaskCommentStore } from "../../core/comments.ts";
import type { supabaseForRequest } from "./supabase";

type Client = NonNullable<Awaited<ReturnType<typeof supabaseForRequest>>>;

export function commentFromRow(row: any): TaskComment {
  return {
    id: row.id,
    taskId: row.task_id,
    ownerId: row.owner_id,
    body: row.body,
    tool: row.tool,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function failed(what: string, error: { message: string }): never {
  throw new Error(`The database refused to ${what}: ${error.message}`);
}

export function supabaseTaskCommentStore(supabase: Client): TaskCommentStore {
  return {
    async insert(row: NewTaskCommentRow) {
      const { data, error } = await supabase
        .from("task_comments")
        .insert({ task_id: row.taskId, body: row.body, tool: row.tool })
        .select()
        .single();
      if (error) failed("post the comment", error);
      return commentFromRow(data);
    },
    async get(id) {
      const { data, error } = await supabase.from("task_comments").select().eq("id", id).maybeSingle();
      if (error) failed("read the comment", error);
      return data ? commentFromRow(data) : null;
    },
    async update(id, body, tool) {
      const { data, error } = await supabase.from("task_comments").update({ body, tool }).eq("id", id).select().maybeSingle();
      if (error) failed("save the comment", error);
      return data ? commentFromRow(data) : null;
    },
    async remove(id) {
      const { data, error } = await supabase.from("task_comments").delete().eq("id", id).select("id");
      if (error) failed("remove the comment", error);
      return (data?.length ?? 0) > 0;
    },
  };
}
