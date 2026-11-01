/**
 * The app's `Mailer` (core/messages.ts): sends an email through Resend, by
 * its plain HTTPS API (https://resend.com/docs/api-reference/emails/send-email),
 * so it works on any host (engineering rule 11). Dane chose Resend on
 * 2026-10-30.
 *
 * Server only. The key, `RESEND_API_KEY`, is read when a message is sent and
 * never goes to the browser (engineering rule 3). Without it, there is no
 * mailer, and the Message form says the message was saved but not emailed.
 *
 * Gmail does not let another service send as a gmail.com address, so the
 * email comes from a WaveCenter address (`MESSAGE_FROM`) and replies go to
 * Dane's Gmail (`MESSAGE_REPLY_TO`). Dane chose `noreply@wavecenter.com` on
 * 2026-11-01. The domain is verified in Resend by docs/EMAIL_SETUP.md.
 */
import type { Mailer } from "../../core/messages.ts";

export const DEFAULT_FROM = "WaveCenter <noreply@wavecenter.com>";
export const DEFAULT_REPLY_TO = "daneofearth@gmail.com";
const FOOTER = "\n\n--\nSent to you through WaveCenter, https://app.wavecenter.com. Reply to this email to answer.";

/** The Resend mailer, or null when this copy of WaveCenter has no key for it. */
export function resendMailer(): Mailer | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  const from = process.env.MESSAGE_FROM || DEFAULT_FROM;
  const replyTo = process.env.MESSAGE_REPLY_TO || DEFAULT_REPLY_TO;
  return {
    async send({ to, subject, text }) {
      let res: Response;
      try {
        res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from, to: [to], reply_to: replyTo, subject, text: text + FOOTER }),
          signal: AbortSignal.timeout(15000),
        });
      } catch {
        throw new Error("The email service could not be reached.");
      }
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        console.error(`mailer: Resend refused an email: HTTP ${res.status} ${detail.slice(0, 300)}`);
        throw new Error(`The email service refused the email (HTTP ${res.status}).`);
      }
    },
  };
}
