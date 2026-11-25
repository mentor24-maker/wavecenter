"use server";

/**
 * The signed-in member's own Star and Trash marks on a message, for the
 * Messages table in Comm's Async mode (Messaging.tsx). Run on the server
 * through core (markMessage) as the tool `wavecenter`, through the member's
 * own session.
 */
import { revalidatePath } from "next/cache";
import { markMessage, type MarkChange, type MessageMark } from "../../core/messages.ts";
import { CoreError, WAVECENTER_TOOL } from "../../core/tool.ts";
import { supabaseMessageStore } from "../lib/messageStore";
import { currentUser, supabaseForRequest } from "../lib/supabase";

export type MarkResult = { ok: true; mark: MessageMark } | { ok: false; error: string };

/**
 * The signed-in member stars, unstars, trashes or restores one of their own
 * messages (WC-180), through core (markMessage). Private to them: the message
 * and the other member's view are untouched. `{ ok: true, mark }` only after
 * the database confirmed the change, and `mark` is what it now holds;
 * anything else is `{ ok: false, error }` in plain words (engineering rule 6).
 */
export async function markMyMessage(messageId: string, change: MarkChange): Promise<MarkResult> {
  let mark: MessageMark;
  try {
    const supabase = await supabaseForRequest();
    if (!supabase) return { ok: false, error: "This copy of WaveCenter has no database settings, so nothing was changed." };
    const { user, checkFailed } = await currentUser(supabase);
    if (!user) {
      return {
        ok: false,
        error: checkFailed
          ? "WaveCenter could not check that you are signed in, so nothing was changed. Try again in a minute."
          : "You are signed out, so nothing was changed. Reload the page and log in again.",
      };
    }
    mark = await markMessage(supabaseMessageStore(supabase), user.id, messageId, change, WAVECENTER_TOOL);
  } catch (err) {
    if (err instanceof CoreError) return { ok: false, error: err.message };
    console.error("comm: could not mark a message:", err);
    return { ok: false, error: "The change did not save. Nothing was changed; try again." };
  }
  revalidatePath("/comm");
  return { ok: true, mark };
}
