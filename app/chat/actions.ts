"use server";

/**
 * The chat window's actions, run on the server through core (startChat,
 * sendChatMessage in core/chat.ts) as the tool `wavecenter`, acting as the
 * signed-in member through their own session, never the service key.
 *
 * Each reports success only after the database confirmed it. Anything else
 * comes back as `{ ok: false, error }` in plain words; the screen shows it
 * and keeps what was typed (engineering rule 6).
 */
import { revalidatePath } from "next/cache";
import { sendChatMessage, startChat } from "../../core/chat.ts";
import { CoreError, WAVECENTER_TOOL } from "../../core/tool.ts";
import { supabaseChatStore } from "../lib/chatStore";
import { currentUser, supabaseForRequest } from "../lib/supabase";

export type ChatStartResult = { ok: true; id: string } | { ok: false; error: string };
export type ChatSendResult = { ok: true } | { ok: false; error: string };

type Signed = { ok: true; store: ReturnType<typeof supabaseChatStore>; memberId: string } | { ok: false; error: string };

async function signedIn(what: string): Promise<Signed> {
  const supabase = await supabaseForRequest();
  if (!supabase) return { ok: false, error: `This copy of WaveCenter has no database settings, so ${what}.` };
  const { user, checkFailed } = await currentUser(supabase);
  if (!user) {
    return {
      ok: false,
      error: checkFailed
        ? `WaveCenter could not check that you are signed in, so ${what}. Try again in a minute.`
        : `You are signed out, so ${what}. Reload the page and log in again.`,
    };
  }
  return { ok: true, store: supabaseChatStore(supabase), memberId: user.id };
}

/** Find or start the signed-in member's chat with `otherMemberId`. Doing it again finds the same chat. */
export async function startChatWith(otherMemberId: string): Promise<ChatStartResult> {
  try {
    const me = await signedIn("no chat was started");
    if (!me.ok) return me;
    const { id } = await startChat(me.store, { memberId: me.memberId, otherMemberId });
    revalidatePath("/chat");
    return { ok: true, id };
  } catch (err) {
    if (err instanceof CoreError) return { ok: false, error: err.message };
    console.error("chat: could not start a chat:", err);
    return { ok: false, error: "Could not start the chat. Nothing was saved; try again." };
  }
}

/** Send `body` in chat `chatId` as the signed-in member. */
export async function sendChat(chatId: string, body: string): Promise<ChatSendResult> {
  try {
    const me = await signedIn("the message was not sent");
    if (!me.ok) return me;
    await sendChatMessage(me.store, { senderId: me.memberId, chatId, body }, WAVECENTER_TOOL);
  } catch (err) {
    if (err instanceof CoreError) return { ok: false, error: err.message };
    console.error("chat: could not send a message:", err);
    return { ok: false, error: "Could not send the message. Nothing was saved; try again." };
  }
  revalidatePath("/chat");
  return { ok: true };
}
