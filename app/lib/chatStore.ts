/**
 * The app's `ChatStore` (core/chat.ts): how core reaches the `chats`,
 * `chat_members` and `chat_messages` tables. It acts through the member's
 * session, never the service key. Every write goes through a database
 * function that repeats core's rules: `start_chat` finds or makes a chat,
 * `send_chat_message` saves a message (and scores it, in the same save).
 * Reading goes straight to the tables, whose row-level security lets a
 * member read only the chats they are in.
 *
 * It only translates names and turns a failed or unconfirmed database call
 * into a thrown error, so a refused save is never reported as a success
 * (engineering rule 6). Server only.
 */
import type { Chat, ChatMessage, ChatStore } from "../../core/chat.ts";
import type { supabaseForRequest } from "./supabase";

type Client = NonNullable<Awaited<ReturnType<typeof supabaseForRequest>>>;

/** The most messages one read of a chat brings back: the newest ones. */
const MESSAGE_READ_LIMIT = 500;

export function supabaseChatStore(supabase: Client): ChatStore {
  return {
    async start(otherMemberId, taskId) {
      const { data, error } = await supabase.rpc("start_chat", { other_member: otherMemberId, about_task: taskId });
      if (error) throw new Error(`The database refused to start the chat: ${error.message}`);
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
        .select("id,task_id,created_by,created_at,chat_members!inner(member_id)")
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
  };
}
