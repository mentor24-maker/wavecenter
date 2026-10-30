"use server";

/**
 * Every change the to-do list makes, run on the server. Each one goes through
 * core (createTask, updateTask, setPoints, castVote, setAgentsOn, attachFile,
 * removeFile, deleteTaskWithFiles, addComment, editComment,
 * removeCommentWithFiles) as
 * the tool `wavecenter`, acting as the signed-in member.
 *
 * Each returns `{ ok: true }` only after the database confirmed the write.
 * Anything else comes back as `{ ok: false, error }` in plain words, and the
 * screen shows it and keeps what was typed (engineering rule 6).
 *
 * The database scores every one of these saves in the engagement ledger, in
 * the same step (core/game.ts). If that part fails, the whole save fails and
 * is reported here like any other failed save.
 */
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { setAgentsOn } from "../../core/agents.ts";
import { addComment, editComment } from "../../core/comments.ts";
import {
  attachFile,
  checkFile,
  commentFilePath,
  deleteTaskWithFiles,
  filePath,
  removeCommentWithFiles,
  removeFile,
} from "../../core/files.ts";
import { setPoints } from "../../core/points.ts";
import { createTask, updateTask, type TaskPriority } from "../../core/tasks.ts";
import { CoreError, WAVECENTER_TOOL } from "../../core/tool.ts";
import { castVote, requireNotVotedOn, type VoteChoice } from "../../core/votes.ts";
import { currentUser, supabaseForRequest } from "../lib/supabase";
import { supabaseMemberSettingsStore } from "../lib/memberSettingsStore";
import { supabaseTaskCommentStore } from "../lib/taskCommentStore";
import { supabaseTaskFileStore, TASK_FILES_BUCKET } from "../lib/taskFileStore";
import { supabaseTaskStore } from "../lib/taskStore";
import { supabaseVoteStore } from "../lib/voteStore";

export type SaveResult = { ok: true } | { ok: false; error: string };

type Supabase = NonNullable<Awaited<ReturnType<typeof supabaseForRequest>>>;
type Store = ReturnType<typeof supabaseTaskStore>;

async function save(
  what: string,
  change: (store: Store, supabase: Supabase, memberId: string) => Promise<unknown>,
): Promise<SaveResult> {
  try {
    const supabase = await supabaseForRequest();
    if (!supabase) return { ok: false, error: "This copy of WaveCenter has no database settings, so nothing can be saved." };
    const { user, checkFailed } = await currentUser(supabase);
    if (!user) {
      return {
        ok: false,
        error: checkFailed
          ? "WaveCenter could not check that you are signed in, so this was not saved. Try again in a minute."
          : "You are signed out, so this was not saved. Reload the page and log in again.",
      };
    }
    await change(supabaseTaskStore(supabase, user.id), supabase, user.id);
  } catch (err) {
    if (err instanceof CoreError) return { ok: false, error: err.message };
    console.error(`tasks: could not ${what}:`, err);
    return { ok: false, error: `Could not ${what}. Nothing was saved; try again.` };
  }
  // The list, and Home, which shows the tasks being worked on.
  revalidatePath("/tasks");
  revalidatePath("/");
  return { ok: true };
}

/**
 * Sub-tasks go one level deep in this version: a parent must be top-level,
 * and a task that already has sub-tasks cannot become one. Core allows deeper
 * trees; this is the to-do list's own limit, so the screen stays simple.
 */
async function requireOneLevel(store: Store, supabase: Supabase, id: string | null, parentTaskId: string) {
  const parent = await store.get(parentTaskId);
  if (parent?.parentTaskId) throw new CoreError(`"${parent.title}" is already a sub-task, and sub-tasks cannot have sub-tasks of their own yet.`);
  if (!id) return; // A task being added has no sub-tasks yet.
  const { count, error } = await supabase.from("tasks").select("id", { count: "exact", head: true }).eq("parent_task_id", id);
  if (error) throw new Error(error.message);
  if (count) throw new CoreError("This task has sub-tasks of its own, so it cannot become a sub-task yet.");
}

/** Details that are only blank space are no details: saved as empty. */
function cleanNotes(notes: string): string | null {
  return notes.trim() ? notes.trim() : null;
}

/** What the add form sends. */
export interface NewTaskFields {
  title: string;
  notes: string;
  parentTaskId: string | null;
  priority: TaskPriority;
}

/** Adding a task also says its id, so files picked in the add form can follow it. */
export async function addTask(fields: NewTaskFields): Promise<SaveResult & { id?: string }> {
  let id = "";
  const result = await save("add the task", async (store, supabase) => {
    if (fields.parentTaskId) await requireOneLevel(store, supabase, null, fields.parentTaskId);
    const task = await createTask(
      store,
      { title: fields.title, notes: cleanNotes(fields.notes), parentTaskId: fields.parentTaskId, priority: fields.priority },
      WAVECENTER_TOOL,
    );
    id = task.id;
  });
  return result.ok ? { ok: true, id } : result;
}

/** Change a task's title and details together, from the row's edit form. */
export async function editTask(id: string, title: string, notes: string): Promise<SaveResult> {
  return save("save the task", (store) => updateTask(store, id, { title, notes: cleanNotes(notes) }, WAVECENTER_TOOL));
}

export async function markDone(id: string, done: boolean): Promise<SaveResult> {
  return save(done ? "mark the task done" : "reopen the task", (store) =>
    updateTask(store, id, { status: done ? "done" : "todo" }, WAVECENTER_TOOL));
}

/** Once members have voted on a task's points, the average decides them and the owner's box is refused. */
export async function changePoints(id: string, points: number): Promise<SaveResult> {
  return save("change the points", async (store, supabase, memberId) => {
    requireNotVotedOn(await supabaseVoteStore(supabase, memberId).forTask(id), "points");
    await setPoints(store, id, points, WAVECENTER_TOOL);
  });
}

export async function moveUnder(id: string, parentTaskId: string | null): Promise<SaveResult> {
  return save("move the task", async (store, supabase) => {
    if (parentTaskId) await requireOneLevel(store, supabase, id, parentTaskId);
    await updateTask(store, id, { parentTaskId }, WAVECENTER_TOOL);
  });
}

/** Deleting a task deletes its attached files from storage too, not just the rows. */
export async function removeTask(id: string): Promise<SaveResult> {
  return save("delete the task", (store, supabase, memberId) =>
    deleteTaskWithFiles(store, supabaseTaskFileStore(supabase, memberId), id, WAVECENTER_TOOL));
}

export async function changePriority(id: string, priority: TaskPriority): Promise<SaveResult> {
  return save("change the priority", async (store, supabase, memberId) => {
    requireNotVotedOn(await supabaseVoteStore(supabase, memberId).forTask(id), "priority");
    await updateTask(store, id, { priority }, WAVECENTER_TOOL);
  });
}

/**
 * Cast, change or withdraw the member's own vote on any task, theirs or
 * anyone's. The database then sets the task's points and priority to the
 * average of every member's votes, in the same save.
 */
export async function vote(taskId: string, choice: VoteChoice): Promise<SaveResult> {
  return save("save your vote", (_store, supabase, memberId) =>
    castVote(supabaseVoteStore(supabase, memberId), taskId, choice, WAVECENTER_TOOL));
}

/**
 * Tick or untick tasks for AI agents: one task, or every open task at once
 * from the tick-all box. Each is saved on its own; if any fail, the answer
 * says how many, and the screen reloads to show what actually saved.
 */
export async function chooseForAgents(ids: string[], selected: boolean): Promise<SaveResult> {
  const what = selected ? "tick the task for AI agents" : "untick the task";
  let failed = 0;
  let firstError = "";
  for (const id of ids) {
    const result = await save(what, (store) => updateTask(store, id, { agentSelected: selected }, WAVECENTER_TOOL));
    if (!result.ok) {
      failed += 1;
      firstError ||= result.error;
    }
  }
  if (!failed) return { ok: true };
  if (ids.length === 1) return { ok: false, error: firstError };
  revalidatePath("/tasks");
  revalidatePath("/");
  return { ok: false, error: `${failed} of ${ids.length} tasks were not saved: ${firstError} The boxes now show what did save.` };
}

export async function switchAgents(on: boolean): Promise<SaveResult> {
  return save(on ? "turn AI agents on" : "turn AI agents off", (_store, supabase, memberId) =>
    setAgentsOn(supabaseMemberSettingsStore(supabase, memberId), on, WAVECENTER_TOOL));
}

/**
 * Attaching a file takes three steps, so a big file never passes through the
 * web server (Vercel refuses requests over about 4.5 MB, and this works the
 * same on any host):
 *
 * 1. `startUpload` checks the file (a name, at most 10 MB, a task of your
 *    own) and asks storage, as you, for a one-time link to put it in your
 *    own folder. No key goes to the browser, only that link.
 * 2. The browser sends the file straight to storage with the link.
 * 3. `finishUpload` records it on the task through core. If that fails, core
 *    deletes the stored copy again, so nothing is left half-saved.
 *
 * Given a `commentId`, the file goes on that Discussion comment instead, in
 * the task's comments folder (core/files.ts).
 */
export type UploadTicket = { ok: true; path: string; uploadUrl: string } | { ok: false; error: string };

export async function startUpload(taskId: string, name: string, sizeBytes: number, commentId: string | null = null): Promise<UploadTicket> {
  let ticket = { path: "", uploadUrl: "" };
  const result = await save("get the file ready to upload", async (store, supabase, memberId) => {
    checkFile(name, sizeBytes);
    if (!(await store.get(taskId))) throw new CoreError(`No task ${taskId} was found that you may attach a file to.`);
    const path = (commentId ? commentFilePath : filePath)(memberId, taskId, randomUUID(), name);
    const { data, error } = await supabase.storage.from(TASK_FILES_BUCKET).createSignedUploadUrl(path);
    if (error) throw new Error(`File storage refused the upload: ${error.message}`);
    ticket = { path, uploadUrl: data.signedUrl };
  });
  return result.ok ? { ok: true, ...ticket } : result;
}

export async function finishUpload(file: {
  taskId: string;
  path: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  commentId?: string | null;
}): Promise<SaveResult> {
  return save("attach the file", (store, supabase, memberId) =>
    attachFile(store, supabaseTaskFileStore(supabase, memberId), file, WAVECENTER_TOOL, supabaseTaskCommentStore(supabase)));
}

export async function removeAttachment(fileId: string): Promise<SaveResult> {
  return save("remove the file", (_store, supabase, memberId) =>
    removeFile(supabaseTaskFileStore(supabase, memberId), fileId, WAVECENTER_TOOL));
}

/** Post a comment in a task's Discussion. Says the comment's id, so files picked for it can follow it. */
export async function postComment(taskId: string, body: string): Promise<SaveResult & { id?: string }> {
  let id = "";
  const result = await save("post the comment", async (store, supabase) => {
    id = (await addComment(store, supabaseTaskCommentStore(supabase), taskId, body, WAVECENTER_TOOL)).id;
  });
  return result.ok ? { ok: true, id } : result;
}

export async function changeComment(id: string, body: string): Promise<SaveResult> {
  return save("save the comment", (_store, supabase) => editComment(supabaseTaskCommentStore(supabase), id, body, WAVECENTER_TOOL));
}

/** Removing a comment removes its files from storage too, not just the rows. */
export async function deleteComment(id: string): Promise<SaveResult> {
  return save("remove the comment", (_store, supabase, memberId) =>
    removeCommentWithFiles(supabaseTaskCommentStore(supabase), supabaseTaskFileStore(supabase, memberId), id, WAVECENTER_TOOL));
}
