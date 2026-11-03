"use server";

/**
 * Making, changing and deleting proposals, run on the server through core
 * (core/proposals.ts) as the tool `wavecenter`, acting as the signed-in
 * member.
 *
 * Each returns `{ ok: true }` only after the database confirmed the write.
 * Anything else comes back as `{ ok: false, error }` in plain words, and the
 * screen shows it and keeps what was typed (engineering rule 6).
 */
import { revalidatePath } from "next/cache";
import { createProposal, deleteProposal, updateProposal, type ProposalStatus, type ProposalStore } from "../../core/proposals.ts";
import type { TaskPriority } from "../../core/tasks.ts";
import { CoreError, WAVECENTER_TOOL } from "../../core/tool.ts";
import { supabaseProposalStore } from "../lib/proposalStore";
import { currentUser, supabaseForRequest } from "../lib/supabase";

export type ProposalSaveResult = { ok: true } | { ok: false; error: string };

/** What the add and edit forms send. */
export interface ProposalFields {
  title: string;
  notes: string;
  points: number;
  priority: TaskPriority;
  status?: ProposalStatus;
}

async function save(what: string, change: (store: ProposalStore) => Promise<unknown>): Promise<ProposalSaveResult> {
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
    await change(supabaseProposalStore(supabase, user.id));
  } catch (err) {
    if (err instanceof CoreError) return { ok: false, error: err.message };
    console.error(`proposals: could not ${what}:`, err);
    return { ok: false, error: `Could not ${what}. Nothing was saved; try again.` };
  }
  revalidatePath("/proposals");
  return { ok: true };
}

export async function addProposal(fields: ProposalFields): Promise<ProposalSaveResult> {
  return save("add the proposal", (store) =>
    createProposal(store, { title: fields.title, notes: fields.notes, points: fields.points, priority: fields.priority }, WAVECENTER_TOOL));
}

export async function editProposal(id: string, fields: ProposalFields): Promise<ProposalSaveResult> {
  return save("save the proposal", (store) =>
    updateProposal(
      store,
      id,
      { title: fields.title, notes: fields.notes, points: fields.points, priority: fields.priority, status: fields.status },
      WAVECENTER_TOOL,
    ));
}

export async function removeProposal(id: string): Promise<ProposalSaveResult> {
  return save("delete the proposal", (store) => deleteProposal(store, id, WAVECENTER_TOOL));
}
