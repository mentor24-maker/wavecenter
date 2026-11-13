/**
 * The app's `TaskCommentStore` (core/comments.ts): how core reaches the
 * `task_comments` table. Like app/lib/taskStore.ts it acts through the
 * signed-in member's own session, so the table's own rules decide what it can
 * touch, and it only translates names and turns a failed call into a thrown
 * error.
 */
import type { NewTaskCommentRow, TaskComment, TaskCommentStore } from "../../core/comments.ts";
import type { TaskStore } from "../../core/tasks.ts";
import type { supabaseForRequest } from "./supabase";
import { fromRow, TOOL_HEADER } from "./taskStore";

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
    async remove(id, tool) {
      const { data, error } = await supabase.from("task_comments").delete().eq("id", id).select("id").setHeader(TOOL_HEADER, tool);
      if (error) failed("remove the comment", error);
      return (data?.length ?? 0) > 0;
    },
  };
}

/**
 * The tasks a member may comment on, for core's `addComment`: every task they
 * can read, which is every task (Dane, 2026-11-12, WC-172). Unlike the app's
 * TaskStore, whose `get` returns only the member's own tasks because it is
 * also the path for changing them.
 */
export function supabaseCommentableTasks(supabase: Client): Pick<TaskStore, "get"> {
  return {
    async get(id) {
      const { data, error } = await supabase.from("tasks").select().eq("id", id).maybeSingle();
      if (error) failed("read the task", error);
      return data ? fromRow(data) : null;
    },
  };
}
