/**
 * The reads the task pages share: attached files with links to them, and
 * Discussion comments. Both act through the signed-in member's own session,
 * so row-level security decides what comes back. Pass a task id to read only
 * that task's; leave it out to read every one the member may see.
 */
import type { TaskComment } from "../../core/comments.ts";
import { isImage } from "../../core/files.ts";
import type { ListFile } from "../tasks/TaskList";
import type { supabaseForRequest } from "./supabase";
import { commentFromRow } from "./taskCommentStore";
import { TASK_FILES_BUCKET } from "./taskFileStore";

type Client = NonNullable<Awaited<ReturnType<typeof supabaseForRequest>>>;

/** How long a link to view or download an attached file works: one hour. */
const FILE_LINK_SECONDS = 60 * 60;

/**
 * Attached files, with a short-lived signed link to each: the bucket is
 * private, so a link is the only way in, and it stops working after an hour.
 * Pictures get a link that opens them; other files a link that downloads.
 * A Discussion comment's files come too (row-level security returns only
 * those of comments the member can see); the list puts them in the thread.
 */
export async function loadFiles(supabase: Client, taskId?: string): Promise<{ files: ListFile[]; error: string | null }> {
  let query = supabase.from("task_files").select("id, task_id, comment_id, path, name, content_type");
  if (taskId) query = query.eq("task_id", taskId);
  const { data: rows, error } = await query.order("created_at");
  if (error) return { files: [], error: error.message };
  if (!rows?.length) return { files: [], error: null };
  const bucket = supabase.storage.from(TASK_FILES_BUCKET);
  const images = rows.filter((r) => isImage(r.content_type));
  const others = rows.filter((r) => !isImage(r.content_type));
  const [shown, downloads] = await Promise.all([
    images.length ? bucket.createSignedUrls(images.map((r) => r.path), FILE_LINK_SECONDS) : { data: [], error: null },
    others.length ? bucket.createSignedUrls(others.map((r) => r.path), FILE_LINK_SECONDS, { download: true }) : { data: [], error: null },
  ]);
  const linkError = shown.error ?? downloads.error;
  if (linkError) return { files: [], error: linkError.message };
  const links = new Map([...(shown.data ?? []), ...(downloads.data ?? [])].map((l) => [l.path, l.signedUrl]));
  return {
    files: rows.map((r) => ({
      id: r.id,
      taskId: r.task_id,
      commentId: r.comment_id,
      name: r.name,
      image: isImage(r.content_type),
      url: links.get(r.path) ?? null,
    })),
    error: null,
  };
}

/** Discussion comments, oldest first. Row-level security returns only the member's own. */
export async function loadComments(supabase: Client, taskId?: string): Promise<{ comments: TaskComment[]; error: string | null }> {
  let query = supabase.from("task_comments").select();
  if (taskId) query = query.eq("task_id", taskId);
  const { data, error } = await query.order("created_at");
  if (error) return { comments: [], error: error.message };
  return { comments: (data ?? []).map(commentFromRow), error: null };
}
