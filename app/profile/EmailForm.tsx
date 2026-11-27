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

/** What the form says after Supabase accepted the request, from what the account now shows. */
function emailChangeOutcome(asked: string, current: string | null, pending: string | null): { ok: boolean; text: string } {
  if (pending) {
    return {
      ok: true,
      text: `We sent a confirmation link to your old and new addresses. Your email stays ${current ?? "as it is"} until both are clicked.`,
    };
  }
  if (current && current.toLowerCase() === asked.trim().toLowerCase()) {
    return { ok: true, text: `Your email address has changed to ${current}.` };
  }
  return {
    ok: false,
    text: "WaveCenter could not confirm the change was started, so your email may not have changed. Reload the page to see what your account shows.",
  };
}

export default function EmailForm({ current, pending: initialPending }: { current: string | null; pending: string | null }) {
  const [email, setEmail] = useState("");
  const [waitingFor, setWaitingFor] = useState<string | null>(initialPending);
  // Follow the page's own reading of the account after it refreshes
  // (revalidatePath), so a waiting address never goes stale.
  const [seenPending, setSeenPending] = useState<string | null>(initialPending);
  if (initialPending !== seenPending) {
    setSeenPending(initialPending);
    setWaitingFor(initialPending);
  }
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
          setMessage(emailChangeOutcome(email, result.current ?? current, result.pending));
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
