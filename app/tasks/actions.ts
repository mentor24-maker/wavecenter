"use server";

/**
 * Every change the to-do list makes, run on the server. Each one goes through
 * core (createTask, updateTask, setPoints, deleteTask) as the tool
 * `wavecenter`, acting as the signed-in member.
 *
 * Each returns `{ ok: true }` only after the database confirmed the write.
 * Anything else comes back as `{ ok: false, error }` in plain words, and the
 * screen shows it and keeps what was typed (engineering rule 6).
 */
import { revalidatePath } from "next/cache";
import { setPoints } from "../../core/points.ts";
import { createTask, deleteTask, updateTask } from "../../core/tasks.ts";
import { CoreError, WAVECENTER_TOOL } from "../../core/tool.ts";
import { currentUser, supabaseForRequest } from "../lib/supabase";
import { supabaseTaskStore } from "../lib/taskStore";

export type SaveResult = { ok: true } | { ok: false; error: string };

type Supabase = NonNullable<Awaited<ReturnType<typeof supabaseForRequest>>>;
type Store = ReturnType<typeof supabaseTaskStore>;

async function save(what: string, change: (store: Store, supabase: Supabase) => Promise<unknown>): Promise<SaveResult> {
  try {
    const supabase = await supabaseForRequest();
    if (!supabase) return { ok: false, error: "This copy of WaveCenter has no database settings, so nothing can be saved." };
    const { user, checkFailed } = await currentUser(supabase);
    if (!user) {
      return {
        ok: false,
        error: checkFailed
          ? "WaveCenter could not check that you are signed in, so this was not saved. Try again in a minute."
          : "You are signed out, so this was not saved. Reload the page and sign in again.",
      };
    }
    await change(supabaseTaskStore(supabase), supabase);
  } catch (err) {
    if (err instanceof CoreError) return { ok: false, error: err.message };
    console.error(`tasks: could not ${what}:`, err);
    return { ok: false, error: `Could not ${what}. Nothing was saved; try again.` };
  }
  revalidatePath("/");
  return { ok: true };
}

/**
 * Sub-tasks go one level deep in this version: a parent must be top-level,
 * and a task that already has sub-tasks cannot become one. Core allows deeper
 * trees; this is the to-do list's own limit, so the screen stays simple.
 */
async function requireOneLevel(store: Store, supabase: Supabase, id: string, parentTaskId: string) {
  const parent = await store.get(parentTaskId);
  if (parent?.parentTaskId) throw new CoreError(`"${parent.title}" is already a sub-task, and sub-tasks cannot have sub-tasks of their own yet.`);
  const { count, error } = await supabase.from("tasks").select("id", { count: "exact", head: true }).eq("parent_task_id", id);
  if (error) throw new Error(error.message);
  if (count) throw new CoreError("This task has sub-tasks of its own, so it cannot become a sub-task yet.");
}

export async function addTask(title: string): Promise<SaveResult> {
  return save("add the task", (store) => createTask(store, { title }, WAVECENTER_TOOL));
}

export async function renameTask(id: string, title: string): Promise<SaveResult> {
  return save("rename the task", (store) => updateTask(store, id, { title }, WAVECENTER_TOOL));
}

export async function markDone(id: string, done: boolean): Promise<SaveResult> {
  return save(done ? "mark the task done" : "reopen the task", (store) =>
    updateTask(store, id, { status: done ? "done" : "todo" }, WAVECENTER_TOOL));
}

export async function changePoints(id: string, points: number): Promise<SaveResult> {
  return save("change the points", (store) => setPoints(store, id, points, WAVECENTER_TOOL));
}

export async function moveUnder(id: string, parentTaskId: string | null): Promise<SaveResult> {
  return save("move the task", async (store, supabase) => {
    if (parentTaskId) await requireOneLevel(store, supabase, id, parentTaskId);
    await updateTask(store, id, { parentTaskId }, WAVECENTER_TOOL);
  });
}

export async function removeTask(id: string): Promise<SaveResult> {
  return save("delete the task", (store) => deleteTask(store, id, WAVECENTER_TOOL));
}
