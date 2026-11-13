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
import { markChatRead, sendChatMessage, startChat, unreadChats } from "../../core/chat.ts";
import { CoreError, WAVECENTER_TOOL } from "../../core/tool.ts";
import { supabaseChatStore } from "../lib/chatStore";
import { currentUser, supabaseForRequest } from "../lib/supabase";

export type ChatStartResult = { ok: true; id: string } | { ok: false; error: string };
export type ChatSendResult = { ok: true } | { ok: false; error: string };
export type ChatReadResult = { ok: true } | { ok: false; error: string };
export type ChatUnreadResult = { ok: true; chats: number; memberId: string } | { ok: false; error: string };

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

/**
 * Find or start the signed-in member's chat with `otherMemberId`, about task
 * `taskId` if given (the task page's "Chat about this task" panel). Doing it
 * again finds the same chat; a chat about a task and a plain chat between the
 * same two are separate. The database refuses a task the member may not read.
 */
export async function startChatWith(otherMemberId: string, taskId: string | null = null): Promise<ChatStartResult> {
  try {
    const me = await signedIn("no chat was started");
    if (!me.ok) return me;
    const { id } = await startChat(me.store, { memberId: me.memberId, otherMemberId, taskId });
    revalidatePath("/chat");
    if (taskId) revalidatePath(`/tasks/${taskId}`);
    return { ok: true, id };
  } catch (err) {
    if (err instanceof CoreError) return { ok: false, error: err.message };
    // The database's own refusal (an unknown member, a task you may not
    // read) is already in plain words: show it.
    const refused = err instanceof Error ? /^The database refused to start the chat: (.+)$/.exec(err.message) : null;
    if (refused) return { ok: false, error: `${refused[1]}` };
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

/**
 * The signed-in member has read chat `chatId` up to now (WC-176). Marks it
 * for them alone. Not scored. A refusal comes back as `{ ok: false }`.
 */
export async function markChatReadNow(chatId: string): Promise<ChatReadResult> {
  try {
    const me = await signedIn("the chat was not marked read");
    if (!me.ok) return me;
    await markChatRead(me.store, { memberId: me.memberId, chatId });
  } catch (err) {
    if (err instanceof CoreError) return { ok: false, error: err.message };
    console.error("chat: could not mark a chat read:", err);
    return { ok: false, error: "Could not mark the chat read. Try again." };
  }
  return { ok: true };
}

/**
 * How many of the signed-in member's chats have unread messages, for the
 * header's Chat badge, and the member's own id, which the badge's live
 * listen filters on. A failed read says so, never 0.
 */
export async function unreadChatCount(): Promise<ChatUnreadResult> {
  try {
    const me = await signedIn("unread chats cannot be counted");
    if (!me.ok) return me;
    const counts = await unreadChats(me.store, me.memberId);
    return { ok: true, chats: counts.size, memberId: me.memberId };
  } catch (err) {
    if (err instanceof CoreError) return { ok: false, error: err.message };
    console.error("chat: could not count unread chats:", err);
    return { ok: false, error: "Unread chats could not be counted." };
  }
}
