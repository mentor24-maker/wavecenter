"use server";

/**
 * Every change the to-do list makes, run on the server. Each one goes through
 * core (createTask, updateTask, setPoints, deleteTask, setAgentsOn) as the tool
 * `wavecenter`, acting as the signed-in member.
 *
 * Each returns `{ ok: true }` only after the database confirmed the write.
 * Anything else comes back as `{ ok: false, error }` in plain words, and the
 * screen shows it and keeps what was typed (engineering rule 6).
 */
import { revalidatePath } from "next/cache";
import { setAgentsOn } from "../../core/agents.ts";
import { setPoints } from "../../core/points.ts";
import { createTask, deleteTask, updateTask, type TaskPriority } from "../../core/tasks.ts";
import { CoreError, WAVECENTER_TOOL } from "../../core/tool.ts";
import { currentUser, supabaseForRequest } from "../lib/supabase";
import { supabaseMemberSettingsStore } from "../lib/memberSettingsStore";
import { supabaseTaskStore } from "../lib/taskStore";

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
          : "You are signed out, so this was not saved. Reload the page and sign in again.",
      };
    }
    await change(supabaseTaskStore(supabase), supabase, user.id);
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

export async function addTask(fields: NewTaskFields): Promise<SaveResult> {
  return save("add the task", async (store, supabase) => {
    if (fields.parentTaskId) await requireOneLevel(store, supabase, null, fields.parentTaskId);
    await createTask(
      store,
      { title: fields.title, notes: cleanNotes(fields.notes), parentTaskId: fields.parentTaskId, priority: fields.priority },
      WAVECENTER_TOOL,
    );
  });
}

/** Change a task's title and details together, from the row's edit form. */
export async function editTask(id: string, title: string, notes: string): Promise<SaveResult> {
  return save("save the task", (store) => updateTask(store, id, { title, notes: cleanNotes(notes) }, WAVECENTER_TOOL));
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

export async function changePriority(id: string, priority: TaskPriority): Promise<SaveResult> {
  return save("change the priority", (store) => updateTask(store, id, { priority }, WAVECENTER_TOOL));
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
  revalidatePath("/");
  return { ok: false, error: `${failed} of ${ids.length} tasks were not saved: ${firstError} The boxes now show what did save.` };
}

export async function switchAgents(on: boolean): Promise<SaveResult> {
  return save(on ? "turn AI agents on" : "turn AI agents off", (_store, supabase, memberId) =>
    setAgentsOn(supabaseMemberSettingsStore(supabase, memberId), on, WAVECENTER_TOOL));
}
