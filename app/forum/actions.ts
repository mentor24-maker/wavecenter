"use server";

/**
 * Adding a topic or a tag to the Forum, and changing or deleting a topic
 * (WC-183) or a tag (WC-186), and attaching or removing a topic's tags
 * (WC-249), run on the server through core (core/forum.ts) as the tool
 * `wavecenter`, acting as the signed-in member.
 *
 * Returns `{ ok: true }` only after the database confirmed the write.
 * Anything else comes back as `{ ok: false, error }` in plain words, and the
 * screen shows it and keeps what was typed (engineering rule 6).
 */
import { revalidatePath } from "next/cache";
import {
  addForumEntry,
  attachTopicTag as attachTopicTagRule,
  deleteTag as deleteTagRule,
  deleteTopic as deleteTopicRule,
  detachTopicTag as detachTopicTagRule,
  editTag as editTagRule,
  editTopic as editTopicRule,
  setTopicParent as setTopicParentRule,
  type ForumKind,
} from "../../core/forum.ts";
import { mayOpenAdmin } from "../../core/members.ts";
import { CoreError, WAVECENTER_TOOL } from "../../core/tool.ts";
import { supabaseForumStore, supabaseTagStore, supabaseTopicStore, supabaseTopicTagStore } from "../lib/forumStore";
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

/** What a tag's edit page sends: the four fields and the ids of its related tags. */
export interface TagForm {
  name: string;
  slug: string;
  description: string;
  details: string;
  relatedIds: string[];
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

/**
 * Set or clear one topic's parent and nothing else (WC-185): the details
 * page's "Parent topic" dropdown, and its "Adopt a sub-topic" dropdown with
 * the chosen topic as `topicId` and the page's topic as `parentId`.
 */
export async function setTopicParent(topicId: string, parentId: string | null): Promise<ForumSaveResult> {
  return run("save the parent topic", "Nothing was changed", async ({ supabase, memberId }) => {
    const actor = { memberId, isAdmin: mayOpenAdmin(await myRole(supabase, memberId)) };
    await setTopicParentRule(supabaseTopicStore(supabase), topicId, parentId, actor, WAVECENTER_TOOL);
  });
}

export async function deleteTopic(id: string): Promise<ForumSaveResult> {
  return run("delete the topic", "Nothing was deleted", async ({ supabase, memberId }) => {
    const actor = { memberId, isAdmin: mayOpenAdmin(await myRole(supabase, memberId)) };
    await deleteTopicRule(supabaseTopicStore(supabase), id, actor, WAVECENTER_TOOL);
  });
}

export async function editTag(id: string, form: TagForm): Promise<ForumSaveResult> {
  return run("save the tag", "Nothing was saved", async ({ supabase, memberId }) => {
    const actor = { memberId, isAdmin: mayOpenAdmin(await myRole(supabase, memberId)) };
    await editTagRule(supabaseTagStore(supabase), id, form, actor, WAVECENTER_TOOL);
  });
}

export async function deleteTag(id: string): Promise<ForumSaveResult> {
  return run("delete the tag", "Nothing was deleted", async ({ supabase, memberId }) => {
    const actor = { memberId, isAdmin: mayOpenAdmin(await myRole(supabase, memberId)) };
    await deleteTagRule(supabaseTagStore(supabase), id, actor, WAVECENTER_TOOL);
  });
}

/** Attach an existing tag to a topic (WC-249). Only the topic's adder or an admin may. */
export async function attachTopicTag(topicId: string, tagId: string): Promise<ForumSaveResult> {
  return run("attach the tag", "Nothing was saved", async ({ supabase, memberId }) => {
    const actor = { memberId, isAdmin: mayOpenAdmin(await myRole(supabase, memberId)) };
    await attachTopicTagRule(supabaseTopicTagStore(supabase), topicId, tagId, actor, WAVECENTER_TOOL);
  });
}

/** Remove a tag from a topic (WC-249). Only the topic's adder or an admin may. */
export async function detachTopicTag(topicId: string, tagId: string): Promise<ForumSaveResult> {
  return run("remove the tag", "Nothing was changed", async ({ supabase, memberId }) => {
    const actor = { memberId, isAdmin: mayOpenAdmin(await myRole(supabase, memberId)) };
    await detachTopicTagRule(supabaseTopicTagStore(supabase), topicId, tagId, actor, WAVECENTER_TOOL);
  });
}
