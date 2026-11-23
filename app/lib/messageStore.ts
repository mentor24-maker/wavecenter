/**
 * The app's `MessageStore` (core/messages.ts): how core reaches the
 * `messages` table. It acts through the member's session, and every write
 * goes through a database function that repeats core's rules:
 * `send_message` saves a message and hands back its id, never an email
 * address, `record_message_email` records how the email went. The address
 * comes from the server's own lookup (messageAddressBook.ts), never this
 * session. Reading goes straight to the table, and its row-level
 * security lets only a message's sender and recipient read it. A member's
 * own Star and Trash marks are read from `message_marks` (row-level security
 * shows each member only theirs) and changed only through `set_message_mark`.
 *
 * It only translates names and turns a failed database call into a thrown
 * error. Server only.
 */
import type { MessageStore } from "../../core/messages.ts";
import type { supabaseForRequest } from "./supabase";

type Client = NonNullable<Awaited<ReturnType<typeof supabaseForRequest>>>;

export function supabaseMessageStore(supabase: Client): MessageStore {
  return {
    async save({ recipientId, subject, body }, tool) {
      const { data, error } = await supabase.rpc("send_message", { recipient: recipientId, subject, body, tool });
      if (error) throw new Error(`The database refused to save the message: ${error.message}`);
      const row = (Array.isArray(data) ? data[0] : data) as { id?: string } | null;
      if (!row?.id) throw new Error("The database did not confirm the message was saved.");
      return { id: row.id };
    },
    async recordEmail(messageId, status) {
      const { data, error } = await supabase.rpc("record_message_email", { message: messageId, status });
      if (error) throw new Error(`The database refused to record the email result: ${error.message}`);
      return typeof data === "string" ? data : null;
    },
    async list(memberId) {
      const { data, error } = await supabase
        .from("messages")
        .select("id,sender_id,recipient_id,subject,body,created_at")
        .or(`sender_id.eq.${memberId},recipient_id.eq.${memberId}`)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw new Error(`The database refused to read your messages: ${error.message}`);
      return (data ?? []).map((r) => ({
        id: r.id,
        senderId: r.sender_id,
        recipientId: r.recipient_id,
        subject: r.subject,
        body: r.body,
        sentAt: r.created_at,
      }));
    },
    async listMarks(memberId) {
      const { data, error } = await supabase
        .from("message_marks")
        .select("message_id,starred,trashed_at")
        .eq("member_id", memberId);
      if (error) throw new Error(`The database refused to read your stars and trash: ${error.message}`);
      return (data ?? []).map((r) => ({ messageId: r.message_id, starred: r.starred === true, trashedAt: r.trashed_at ?? null }));
    },
    async setMark(messageId, change, tool) {
      const { data, error } = await supabase.rpc("set_message_mark", {
        message: messageId,
        star: change.starred ?? null,
        trash: change.trashed ?? null,
        tool,
      });
      if (error) throw new Error(`The database refused the change: ${error.message}`);
      const row = (Array.isArray(data) ? data[0] : data) as { message_id?: string; starred?: boolean; trashed_at?: string | null } | null;
      if (!row?.message_id) throw new Error("The database did not confirm the change was saved.");
      return { messageId: row.message_id, starred: row.starred === true, trashedAt: row.trashed_at ?? null };
    },
  };
}
