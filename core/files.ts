/**
 * Files attached to a task: a logo, a screenshot, a document. The only path
 * for attaching, removing and clearing them.
 *
 * A file has two halves: the stored copy (in file storage, under the owner's
 * own folder) and a row in `task_files` that says which task it belongs to.
 * Core keeps the two in step. A row is only written for a copy that is
 * already stored, and if the row cannot be written the copy is deleted again,
 * so a failed attach leaves nothing half-saved. Removing deletes the copy
 * first and the row second: if the second step fails, the file still shows
 * and removing it again finishes the job, instead of a copy nobody can see
 * lingering in storage.
 *
 * Core does not know about Supabase. It talks to a `TaskFileStore`, which a
 * client supplies, and to the same `TaskStore` as core/tasks.ts. The
 * plain-words description of the table is docs/DATA_MODEL.md.
 */
import { CoreError, requireTool } from './tool.ts';
import { deleteTask, type TaskStore } from './tasks.ts';

/** The largest file a member may attach: 10 MB. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** File types shown as a picture rather than a download link. */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'] as const;

/** One row of `task_files`, in core's own names. */
export interface TaskFile {
  id: string;
  taskId: string;
  ownerId: string;
  /** Where the stored copy lives: `<owner id>/<task id>/<random id>-<file name>`. */
  path: string;
  name: string;
  contentType: string | null;
  sizeBytes: number;
  /** The tool that attached it. */
  tool: string;
  createdAt: string;
}

/** The fields a store writes for a new file row. The owner is the signed-in member. */
export interface NewTaskFileRow {
  taskId: string;
  path: string;
  name: string;
  contentType: string | null;
  sizeBytes: number;
  tool: string;
}

/**
 * What core needs from storage: the `task_files` rows and the stored copies.
 * An adapter translates these calls and decides nothing.
 */
export interface TaskFileStore {
  insert(row: NewTaskFileRow): Promise<TaskFile>;
  get(id: string): Promise<TaskFile | null>;
  /** Every file on one task the caller can see, oldest first. */
  listForTask(taskId: string): Promise<TaskFile[]>;
  /** Delete one row. Returns false if there is no such row the caller may delete. */
  remove(id: string): Promise<boolean>;
  /** Delete stored copies. A path that is already gone is not an error. */
  deleteObjects(paths: string[]): Promise<void>;
}

/** What a client says about a file it has just stored. */
export interface NewTaskFile {
  taskId: string;
  path: string;
  name: string;
  contentType?: string | null;
  sizeBytes: number;
}

/** True for the file types the screen shows as a picture. */
export function isImage(contentType: string | null | undefined): boolean {
  return IMAGE_TYPES.includes((contentType ?? '').toLowerCase() as (typeof IMAGE_TYPES)[number]);
}

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The checks a file must pass before it is even uploaded: a name, and a size
 * of at most 10 MB. A screen calls this first so a too-big file is refused
 * straight away; `attachFile` calls it again, so no client can skip it.
 * Returns the name trimmed.
 */
export function checkFile(name: unknown, sizeBytes: unknown): string {
  if (typeof name !== 'string' || name.trim() === '') throw new CoreError('A file needs a name, and it cannot be blank.');
  if (typeof sizeBytes !== 'number' || !Number.isInteger(sizeBytes) || sizeBytes < 0) {
    throw new CoreError(`A file's size must be a whole number of bytes; got "${String(sizeBytes)}".`);
  }
  if (sizeBytes > MAX_FILE_BYTES) {
    throw new CoreError(`"${name.trim()}" is ${megabytes(sizeBytes)}, and files can be at most 10 MB. Nothing was attached.`);
  }
  return name.trim();
}

/**
 * Where a new file is stored: `<owner id>/<task id>/<random id>-<file name>`.
 * The owner's folder comes first because the storage rules let each member
 * reach only their own folder. Slashes and other awkward characters in the
 * name are replaced, so a name can never step into another folder.
 */
export function filePath(ownerId: string, taskId: string, randomId: string, name: string): string {
  const safe = name.trim().replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '_').slice(-120) || 'file';
  return `${ownerId}/${taskId}/${randomId}-${safe}`;
}

/** The task must be one the caller can see; the store only returns their own. */
async function requireTask(tasks: TaskStore, taskId: string, what: string) {
  const task = await tasks.get(taskId);
  if (!task) throw new CoreError(`No task ${taskId} was found that you may ${what}.`);
  return task;
}

/**
 * Record a file that has already been stored at `input.path`, on behalf of
 * `tool`. If any rule refuses it, or the row cannot be written, the stored
 * copy is deleted again and the error is passed on. Only a copy in this
 * task's folder is cleaned up, so a bad path can never delete another file.
 */
export async function attachFile(tasks: TaskStore, files: TaskFileStore, input: NewTaskFile, tool: string): Promise<TaskFile> {
  const inTaskFolder = typeof input.path === 'string' && input.path.split('/')[1] === input.taskId;
  try {
    if (!inTaskFolder) {
      throw new CoreError("That file was not stored in this task's own folder, so it was not attached.");
    }
    const row: NewTaskFileRow = {
      tool: requireTool(tool),
      name: checkFile(input.name, input.sizeBytes),
      sizeBytes: input.sizeBytes,
      contentType: input.contentType?.trim() || null,
      taskId: input.taskId,
      path: input.path,
    };
    const task = await requireTask(tasks, input.taskId, 'attach a file to');
    if (!input.path.startsWith(`${task.ownerId}/${task.id}/`)) {
      throw new CoreError("That file was not stored in this task's own folder, so it was not attached.");
    }
    return await files.insert(row);
  } catch (err) {
    if (inTaskFolder) await files.deleteObjects([input.path]).catch(() => {
      // The original error is the one worth reporting.
    });
    throw err;
  }
}

/** Remove one file from its task on behalf of `tool`: the stored copy, then the row. */
export async function removeFile(files: TaskFileStore, id: string, tool: string): Promise<TaskFile> {
  requireTool(tool);
  const file = await files.get(id);
  if (!file) throw new CoreError(`No file ${id} was found that you may remove.`);
  await files.deleteObjects([file.path]);
  if (!(await files.remove(id))) throw new CoreError(`No file ${id} was found that you may remove.`);
  return file;
}

/**
 * Delete a task and every file attached to it, on behalf of `tool`. The
 * stored copies go first (the rows go with the task), so a failure part-way
 * leaves the task in place to delete again, never copies nobody can reach.
 * Sub-tasks are kept, as in `deleteTask`, and keep their own files.
 */
export async function deleteTaskWithFiles(tasks: TaskStore, files: TaskFileStore, id: string, tool: string): Promise<void> {
  requireTool(tool);
  await requireTask(tasks, id, 'delete');
  const attached = await files.listForTask(id);
  if (attached.length) await files.deleteObjects(attached.map((f) => f.path));
  await deleteTask(tasks, id, tool);
}
