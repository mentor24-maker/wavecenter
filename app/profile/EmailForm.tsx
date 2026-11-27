"use client";

/**
 * "Email address" on the profile page (WC-255): the member's current sign-in
 * address and a way to change it. A change is never called done here:
 * Supabase emails a link to the old and the new address, and the address
 * changes only once both are opened. Until then the form says what it is
 * waiting for, and the page shows the same after a reload (Supabase keeps
 * the waiting address on the account). A failure says so and keeps what was
 * typed (engineering rule 6).
 */
import { useState, useTransition, type FormEvent } from "react";
import { changeMyEmail } from "./actions";

const UNREACHABLE =
  "Could not reach WaveCenter, so nothing was changed. Check your connection and try again; what you typed is still here.";

export default function EmailForm({ current, pending: initialPending }: { current: string | null; pending: string | null }) {
  const [email, setEmail] = useState("");
  const [waitingFor, setWaitingFor] = useState<string | null>(initialPending);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [sending, startTransition] = useTransition();

  function submit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await changeMyEmail(email);
        if (result.ok) {
          setWaitingFor(result.pending);
          setEmail("");
          setMessage({
            ok: true,
            text: `We sent a confirmation link to your old and new addresses. Your email stays ${result.current ?? current ?? "as it is"} until both are clicked.`,
          });
        } else {
          setMessage({ ok: false, text: result.error });
        }
      } catch {
        setMessage({ ok: false, text: UNREACHABLE });
      }
    });
  }

  return (
    <form className="stack profile" onSubmit={submit}>
      <p>
        Your email address: <strong>{current ?? "(none on this account)"}</strong>
      </p>
      <p className="note">
        You sign in with it and WaveCenter delivers your messages to it. Nobody else can see it. Changing it keeps your
        account, tasks, points and messages exactly as they are.
      </p>
      {waitingFor && (
        <p className="note" role="status">
          Waiting for confirmation: <strong>{waitingFor}</strong>. Open the links sent to both addresses to finish.
        </p>
      )}
      <label htmlFor="new-email">New email address</label>
      <input
        id="new-email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => { setEmail(e.target.value); setMessage((m) => (m?.ok ? m : null)); }}
      />
      <button type="submit" disabled={sending}>{sending ? "Sending…" : "Change email"}</button>
      {message && (
        <p className={message.ok ? "note" : "error"} role={message.ok ? "status" : "alert"}>{message.text}</p>
      )}
    </form>
  );
}
