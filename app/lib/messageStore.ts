/**
 * The app's `MessageStore` (core/messages.ts): how core reaches the
 * `messages` table. It acts through the member's session, and every write
 * goes through a database function that repeats core's rules:
 * `send_message` saves a message (and hands back the recipient's email
 * address, for the server to email them), `record_message_email` records how
 * the email went.
 *
 * It only translates names and turns a failed database call into a thrown
 * error. Server only: the address it reads never goes to the browser.
 */
import type { MessageStore } from "../../core/messages.ts";
import type { supabaseForRequest } from "./supabase";

type Client = NonNullable<Awaited<ReturnType<typeof supabaseForRequest>>>;

export function supabaseMessageStore(supabase: Client): MessageStore {
  return {
    async save({ recipientId, subject, body }, tool) {
      const { data, error } = await supabase.rpc("send_message", { recipient: recipientId, subject, body, tool });
      if (error) throw new Error(`The database refused to save the message: ${error.message}`);
      const row = (Array.isArray(data) ? data[0] : data) as { id?: string; recipient_email?: string | null } | null;
      if (!row?.id) throw new Error("The database did not confirm the message was saved.");
      return { id: row.id, recipientEmail: row.recipient_email ?? null };
    },
    async recordEmail(messageId, status) {
      const { data, error } = await supabase.rpc("record_message_email", { message: messageId, status });
      if (error) throw new Error(`The database refused to record the email result: ${error.message}`);
      return typeof data === "string" ? data : null;
    },
  };
}
