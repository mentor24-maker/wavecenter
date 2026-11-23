"use server";

/**
 * Adding a topic or a tag to the Forum, and changing or deleting a topic
 * (WC-183), run on the server through core (core/forum.ts) as the tool
 * `wavecenter`, acting as the signed-in member.
 *
 * Returns `{ ok: true }` only after the database confirmed the write.
 * Anything else comes back as `{ ok: false, error }` in plain words, and the
 * screen shows it and keeps what was typed (engineering rule 6).
 */
import { revalidatePath } from "next/cache";
import { addForumEntry, deleteTopic as deleteTopicRule, editTopic as editTopicRule, type ForumKind } from "../../core/forum.ts";
import { mayOpenAdmin } from "../../core/members.ts";
import { CoreError, WAVECENTER_TOOL } from "../../core/tool.ts";
import { supabaseForumStore, supabaseTopicStore } from "../lib/forumStore";
import { myRole } from "../lib/memberRoleStore";
import { currentUser, supabaseForRequest } from "../lib/supabase";

export type ForumSaveResult = { ok: true } | { ok: false; error: string };

/** What the edit page sends: the four fields and the parent ("" for none). */
export interface TopicForm {
  name: string;
  slug: string;
  description: string;
  details: string;
  parentId: string;
}

type Signed = { ok: false; error: string } | { ok: true; supabase: NonNullable<Awaited<ReturnType<typeof supabaseForRequest>>>; memberId: string };

async function signedIn(): Promise<Signed> {
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
  return { ok: true, supabase, memberId: user.id };
}

/** Run one write; a rule's refusal is shown as written, anything else in plain words. */
async function run(what: string, nothing: string, write: (s: Extract<Signed, { ok: true }>) => Promise<void>): Promise<ForumSaveResult> {
  try {
    const signed = await signedIn();
    if (!signed.ok) return signed;
    await write(signed);
  } catch (err) {
    if (err instanceof CoreError) return { ok: false, error: err.message };
    console.error(`forum: could not ${what}:`, err);
    return { ok: false, error: `Could not ${what}. ${nothing}; try again.` };
  }
  revalidatePath("/forum", "layout");
  return { ok: true };
}

export async function addForum(kind: ForumKind, name: string): Promise<ForumSaveResult> {
  return run(`add the ${kind === "tag" ? "tag" : "topic"}`, "Nothing was saved", async ({ supabase }) => {
    await addForumEntry(supabaseForumStore(supabase), kind, name, WAVECENTER_TOOL);
  });
}

export async function editTopic(id: string, form: TopicForm): Promise<ForumSaveResult> {
  return run("save the topic", "Nothing was saved", async ({ supabase, memberId }) => {
    const actor = { memberId, isAdmin: mayOpenAdmin(await myRole(supabase, memberId)) };
    await editTopicRule(supabaseTopicStore(supabase), id, form, actor, WAVECENTER_TOOL);
  });
}

export async function deleteTopic(id: string): Promise<ForumSaveResult> {
  return run("delete the topic", "Nothing was deleted", async ({ supabase, memberId }) => {
    const actor = { memberId, isAdmin: mayOpenAdmin(await myRole(supabase, memberId)) };
    await deleteTopicRule(supabaseTopicStore(supabase), id, actor, WAVECENTER_TOOL);
  });
}
