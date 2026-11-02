/**
 * The app's `MessageAddressBook` (core/messages.ts): where the server finds a
 * message's recipient's email address so it can email them. It never asks
 * through the member's session, so no member can collect another's address.
 * It calls the database's `message_recipient_email` with the service key,
 * the only key that function accepts, and that function answers only for a
 * pending message the named sender sent.
 *
 * Server only. The service key, `SUPABASE_SERVICE_ROLE_KEY`, ignores
 * row-level security, so it is read here, when a message is sent, and never
 * goes to the browser (engineering rule 3; `check:browser-secrets` proves
 * it). It talks to Supabase's plain HTTPS API, so it works on any host
 * (engineering rule 11). Without the key there is no address book, and the
 * Message form says the message was saved but not emailed. When a member
 * passes the hourly email limit, the database says so (code WC429) and those
 * words reach the sender.
 */
import "server-only";
import type { MessageAddressBook } from "../../core/messages.ts";
import { CoreError } from "../../core/tool.ts";

/** The address book, or null when this copy of WaveCenter has no service key. */
export function serviceAddressBook(): MessageAddressBook | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return {
    async recipientEmail(messageId, senderId) {
      let res: Response;
      try {
        res = await fetch(`${url}/rest/v1/rpc/message_recipient_email`, {
          method: "POST",
          headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ message: messageId, sender: senderId }),
          cache: "no-store",
          signal: AbortSignal.timeout(10000),
        });
      } catch (err) {
        console.error("messages: the address lookup could not reach the database:", err);
        throw new Error("The address lookup could not reach the database.");
      }
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        const refusal = (() => {
          try {
            return JSON.parse(detail) as { code?: string; message?: string };
          } catch {
            return null;
          }
        })();
        if (refusal?.code === "WC429" && refusal.message) throw new CoreError(refusal.message);
        console.error(`messages: the address lookup was refused: HTTP ${res.status} ${detail.slice(0, 300)}`);
        throw new Error(`The address lookup was refused (HTTP ${res.status}).`);
      }
      const email: unknown = await res.json();
      return typeof email === "string" && email !== "" ? email : null;
    },
  };
}
