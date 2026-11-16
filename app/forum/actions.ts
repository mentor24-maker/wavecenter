"use server";

/**
 * Adding a topic or a tag to the Forum, run on the server through core
 * (core/forum.ts) as the tool `wavecenter`, acting as the signed-in member.
 *
 * Returns `{ ok: true }` only after the database confirmed the write.
 * Anything else comes back as `{ ok: false, error }` in plain words, and the
 * screen shows it and keeps what was typed (engineering rule 6).
 */
import { revalidatePath } from "next/cache";
import { addForumEntry, type ForumKind } from "../../core/forum.ts";
import { CoreError, WAVECENTER_TOOL } from "../../core/tool.ts";
import { supabaseForumStore } from "../lib/forumStore";
import { currentUser, supabaseForRequest } from "../lib/supabase";

export type ForumSaveResult = { ok: true } | { ok: false; error: string };

export async function addForum(kind: ForumKind, name: string): Promise<ForumSaveResult> {
  const what = `add the ${kind === "tag" ? "tag" : "topic"}`;
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
    await addForumEntry(supabaseForumStore(supabase), kind, name, WAVECENTER_TOOL);
  } catch (err) {
    if (err instanceof CoreError) return { ok: false, error: err.message };
    console.error(`forum: could not ${what}:`, err);
    return { ok: false, error: `Could not ${what}. Nothing was saved; try again.` };
  }
  revalidatePath("/forum");
  return { ok: true };
}
