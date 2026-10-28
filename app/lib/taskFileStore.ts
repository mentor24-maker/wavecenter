/**
 * The app's `TaskFileStore` (core/files.ts): how core reaches the
 * `task_files` table and the private `task-files` storage bucket. Like
 * app/lib/taskStore.ts it acts through the signed-in member's own session, so
 * the database's and the bucket's own rules decide what it can touch, and it
 * only translates names and turns a failed call into a thrown error.
 */
import type { NewTaskFileRow, TaskFile, TaskFileStore } from "../../core/files.ts";
import type { supabaseForRequest } from "./supabase";
import { TOOL_HEADER } from "./taskStore";

type Client = NonNullable<Awaited<ReturnType<typeof supabaseForRequest>>>;

/** The private bucket every attached file is stored in. */
export const TASK_FILES_BUCKET = "task-files";

export function fileFromRow(row: any): TaskFile {
  return {
    id: row.id,
    taskId: row.task_id,
    ownerId: row.owner_id,
    path: row.path,
    name: row.name,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    tool: row.tool,
    createdAt: row.created_at,
  };
}

function failed(what: string, error: { message: string }): never {
  throw new Error(`The database refused to ${what}: ${error.message}`);
}

export function supabaseTaskFileStore(supabase: Client): TaskFileStore {
  return {
    async insert(row: NewTaskFileRow) {
      const { data, error } = await supabase
        .from("task_files")
        .insert({
          task_id: row.taskId,
          path: row.path,
          name: row.name,
          content_type: row.contentType,
          size_bytes: row.sizeBytes,
          tool: row.tool,
        })
        .select()
        .single();
      if (error) failed("attach the file", error);
      return fileFromRow(data);
    },
    async get(id) {
      const { data, error } = await supabase.from("task_files").select().eq("id", id).maybeSingle();
      if (error) failed("read the file", error);
      return data ? fileFromRow(data) : null;
    },
    async listForTask(taskId) {
      const { data, error } = await supabase.from("task_files").select().eq("task_id", taskId).order("created_at");
      if (error) failed("list the task's files", error);
      return (data ?? []).map(fileFromRow);
    },
    async remove(id, tool) {
      const { data, error } = await supabase.from("task_files").delete().eq("id", id).select("id").setHeader(TOOL_HEADER, tool);
      if (error) failed("remove the file", error);
      return (data?.length ?? 0) > 0;
    },
    async deleteObjects(paths) {
      const { error } = await supabase.storage.from(TASK_FILES_BUCKET).remove(paths);
      if (error) throw new Error(`File storage refused to delete the file: ${error.message}`);
    },
  };
}
