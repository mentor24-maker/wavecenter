/**
 * The app's `ChatStore` (core/chat.ts): how core reaches the `chats`,
 * `chat_members` and `chat_messages` tables. It acts through the member's
 * session, never the service key. Every write goes through a database
 * function that repeats core's rules: `start_chat` finds or makes a chat,
 * `send_chat_message` saves a message (and scores it, in the same save).
 * Reading goes straight to the tables, whose row-level security lets a
 * member read only the chats they are in.
 *
 * Unread messages (WC-176): `markRead` goes through `mark_chat_read`, which
 * marks the chat read for the signed-in member alone; `unread` asks
 * `my_chat_unread`, which counts by core's rule under row-level security.
 *
 * `latestChatMessages` reads the newest message of each chat, for the chat
 * window's list (app/chat); `chatTaskTitles` reads the titles of the tasks
 * chats are about, for their labels.
 *
 * It only translates names and turns a failed or unconfirmed database call
 * into a thrown error, so a refused save is never reported as a success
 * (engineering rule 6). Server only.
 */
import type { Chat, ChatMessage, ChatReadStore, ChatStore } from "../../core/chat.ts";
import type { supabaseForRequest } from "./supabase";

type Client = NonNullable<Awaited<ReturnType<typeof supabaseForRequest>>>;

/** The most messages one read of a chat brings back: the newest ones. */
const MESSAGE_READ_LIMIT = 500;

export function supabaseChatStore(supabase: Client): ChatStore & ChatReadStore {
  return {
    async start(otherMemberId, taskId) {
      const { data, error } = await supabase.rpc("start_chat", { other_member: otherMemberId, about_task: taskId });
      if (error) {
        // Only start_chat's own refusals (raised with these codes, in plain
        // words) are marked as refusals the screen may show. Anything else,
        // such as Postgres's "invalid input syntax for type uuid", is logged
        // and the member sees a plain failure instead (WC-175 review).
        if (error.code === "22023" || error.code === "42501") throw new Error(`The database refused to start the chat: ${error.message}`);
        throw new Error(`The database could not start the chat (${error.code ?? "no code"}): ${error.message}`);
      }
      if (typeof data !== "string" || !data) throw new Error("The database did not confirm the chat was started.");
      return { id: data };
    },
    async send(chatId, body, tool) {
      const { data, error } = await supabase.rpc("send_chat_message", { chat: chatId, body, tool });
      if (error) throw new Error(`The database refused to save the chat message: ${error.message}`);
      if (typeof data !== "string" || !data) throw new Error("The database did not confirm the chat message was saved.");
      return { id: data };
    },
    async chats(memberId): Promise<Chat[]> {
      const { data, error } = await supabase
        .from("chats")
        .select("id,task_id,about_a_task,created_by,created_at,chat_members!inner(member_id)")
        .eq("chat_members.member_id", memberId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw new Error(`The database refused to read your chats: ${error.message}`);
      const ids = (data ?? []).map((c) => c.id);
      // The filter above keeps only the member's own row in each chat, so read
      // everyone in those chats separately.
      const everyone = new Map<string, string[]>();
      if (ids.length) {
        const members = await supabase.from("chat_members").select("chat_id,member_id").in("chat_id", ids);
        if (members.error) throw new Error(`The database refused to read who is in your chats: ${members.error.message}`);
        for (const m of members.data ?? []) everyone.set(m.chat_id, [...(everyone.get(m.chat_id) ?? []), m.member_id]);
      }
      return (data ?? []).map((c) => ({
        id: c.id,
        taskId: c.task_id,
        aboutATask: Boolean(c.about_a_task),
        memberIds: everyone.get(c.id) ?? [],
        createdBy: c.created_by,
        createdAt: c.created_at,
      }));
    },
    async messages(chatId): Promise<ChatMessage[]> {
      const { data, error } = await supabase
        .from("chat_messages")
        .select("id,chat_id,sender_id,body,tool,created_at")
        .eq("chat_id", chatId)
        .order("created_at", { ascending: false })
        .limit(MESSAGE_READ_LIMIT);
      if (error) throw new Error(`The database refused to read the chat: ${error.message}`);
      return (data ?? []).map((m) => ({
        id: m.id,
        chatId: m.chat_id,
        senderId: m.sender_id,
        body: m.body,
        tool: m.tool,
        sentAt: m.created_at,
      }));
    },
    async markRead(chatId) {
      const { data, error } = await supabase.rpc("mark_chat_read", { chat: chatId });
      if (error) throw new Error(`The database refused to mark the chat read: ${error.message}`);
      if (typeof data !== "string" || !data) throw new Error("The database did not confirm the chat was marked read.");
      return { readAt: data };
    },
    async unread() {
      const { data, error } = await supabase.rpc("my_chat_unread");
      if (error) throw new Error(`The database refused to count your unread chat messages: ${error.message}`);
      if (!Array.isArray(data)) throw new Error("The database did not hand back your unread chat messages.");
      return data.map((r: { chat_id: string; unread: number }) => ({ chatId: r.chat_id, unread: r.unread }));
    },
  };
}

/** How many recent messages one read for the chat list looks through before asking chat by chat. */
const LATEST_SCAN = 1000;

/**
 * The newest message in each of `chatIds`, for the chat list (app/chat).
 * One read of the most recent messages covers the busy chats; any chat with
 * no message among them is then asked on its own, so a quiet chat still
 * shows its last message. Row-level security keeps it to the member's own
 * chats. A failed read throws.
 */
export async function latestChatMessages(supabase: Client, chatIds: string[]): Promise<Map<string, ChatMessage>> {
  const latest = new Map<string, ChatMessage>();
  if (!chatIds.length) return latest;
  const toMessage = (m: { id: string; chat_id: string; sender_id: string; body: string; tool: string; created_at: string }): ChatMessage => ({
    id: m.id, chatId: m.chat_id, senderId: m.sender_id, body: m.body, tool: m.tool, sentAt: m.created_at,
  });
  const columns = "id,chat_id,sender_id,body,tool,created_at";
  const recent = await supabase
    .from("chat_messages")
    .select(columns)
    .in("chat_id", chatIds)
    .order("created_at", { ascending: false })
    .limit(LATEST_SCAN);
  if (recent.error) throw new Error(`The database refused to read your chats' last messages: ${recent.error.message}`);
  for (const m of recent.data ?? []) if (!latest.has(m.chat_id)) latest.set(m.chat_id, toMessage(m));
  // Fewer rows than the scan means every message was seen: a chat still
  // missing has none. Otherwise ask each missing chat for its newest.
  if ((recent.data ?? []).length < LATEST_SCAN) return latest;
  const missing = chatIds.filter((id) => !latest.has(id));
  const reads = await Promise.all(
    missing.map((id) =>
      supabase.from("chat_messages").select(columns).eq("chat_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ),
  );
  for (const read of reads) {
    if (read.error) throw new Error(`The database refused to read a chat's last message: ${read.error.message}`);
    if (read.data) latest.set(read.data.chat_id, toMessage(read.data));
  }
  return latest;
}

/**
 * The titles of the tasks `chats` are about, task id to title, for the chat
 * window's labels. A task the member may not read, or one since deleted, is
 * simply missing. A failed read throws.
 */
export async function chatTaskTitles(supabase: Client, chats: Pick<Chat, "taskId">[]): Promise<Map<string, string>> {
  const ids = [...new Set(chats.map((c) => c.taskId).filter((id): id is string => Boolean(id)))];
  const titles = new Map<string, string>();
  if (!ids.length) return titles;
  const { data, error } = await supabase.from("tasks").select("id,title").in("id", ids);
  if (error) throw new Error(`The database refused to read the tasks your chats are about: ${error.message}`);
  for (const t of data ?? []) titles.set(t.id, t.title);
  return titles;
}
