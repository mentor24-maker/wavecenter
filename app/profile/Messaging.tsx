"use client";

/**
 * The Messaging section of Your profile: a Send Message block, folded shut
 * until clicked, and the Messages block, the messages the member sent or
 * received, newest first. A message's subject opens its text.
 *
 * Sending goes through the same server action as the Members page's Message
 * button (sendMemberMessage), so it saves and emails the same way, and the
 * form says exactly what happened: sent; saved but not emailed, and why; or
 * not sent at all (engineering rule 6). After a save the page reloads its
 * messages, so the new one shows in Messages. No email address ever comes to
 * the browser: members are named only as their profile allows.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { messageProblem } from "../../core/messages.ts";
import { sendMemberMessage } from "../members/actions";

export interface ShownMessage {
  id: string;
  /** "from" a message they received, "to" one they sent, "self" a note to themself. */
  direction: "from" | "to" | "self";
  /** The other member's name as their profile allows. */
  other: string;
  subject: string;
  body: string;
  /** When it was sent, in Mountain time. */
  when: string;
}

export interface Recipient {
  memberId: string;
  label: string;
}

const UNREACHABLE = "Could not reach WaveCenter, so nothing was sent. Check your connection and try again.";

export default function Messaging({
  messages,
  readError,
  recipients,
  sendBlocked,
}: {
  messages: ShownMessage[];
  /** Why the messages could not be read, or null if they were. */
  readError: string | null;
  recipients: Recipient[];
  /** Why this member cannot send, in plain words, or null if they can. */
  sendBlocked: string | null;
}) {
  return (
    <section className="panel messaging" aria-labelledby="messaging-heading">
      <h2 id="messaging-heading">Messaging</h2>
      <SendMessage recipients={recipients} blocked={sendBlocked} />
      <h3>Messages</h3>
      <MessageList messages={messages} readError={readError} />
    </section>
  );
}

function SendMessage({ recipients, blocked }: { recipients: Recipient[]; blocked: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [message, setMessage] = useState<{ kind: "sent" | "saved" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function cancel() {
    if (pending) return;
    setOpen(false);
    setMessage(null);
  }

  function send(e: FormEvent) {
    e.preventDefault();
    const recipient = recipients.find((r) => r.memberId === to);
    if (!recipient) {
      setMessage({ kind: "error", text: "Not sent. Pick who the message is to." });
      return;
    }
    const problem = messageProblem(subject, body);
    if (problem) {
      setMessage({ kind: "error", text: `Not sent. ${problem}` });
      return;
    }
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await sendMemberMessage(recipient.memberId, subject, body);
        if (!result.ok) {
          setMessage({ kind: "error", text: `Not sent. ${result.error}` });
          return;
        }
        // Stored: empty the fields now, so the same message cannot go twice.
        setSubject("");
        setBody("");
        if (result.emailed) setMessage({ kind: "sent", text: `Sent. The message is saved and was emailed to ${recipient.label}.` });
        else setMessage({ kind: "saved", text: `The message is saved in WaveCenter, but it was not emailed. ${result.reason}` });
        router.refresh();
      } catch {
        setMessage({ kind: "error", text: UNREACHABLE });
      }
    });
  }

  return (
    <div className="send-message">
      <h3>
        <button type="button" className="section-toggle" aria-expanded={open} onClick={() => (open ? cancel() : setOpen(true))}>
          {open ? "▾" : "▸"} Send Message
        </button>
      </h3>
      {open &&
        (blocked !== null ? (
          <p className="note" role="status">{blocked}</p>
        ) : (
          <form className="stack message-compose" onSubmit={send}>
            <label>
              To
              <select value={to} disabled={pending} onChange={(e) => setTo(e.target.value)}>
                <option value="">Pick a member…</option>
                {recipients.map((r) => (
                  <option key={r.memberId} value={r.memberId}>{r.label}</option>
                ))}
              </select>
            </label>
            <label>
              Subject
              <input type="text" value={subject} maxLength={200} disabled={pending} onChange={(e) => setSubject(e.target.value)} />
            </label>
            <label>
              Message
              <textarea rows={5} value={body} maxLength={10000} disabled={pending} onChange={(e) => setBody(e.target.value)} />
            </label>
            {pending && <p className="note" role="status">Sending…</p>}
            {message && (
              <p className={message.kind === "error" ? "error" : "note"} role={message.kind === "error" ? "alert" : "status"}>{message.text}</p>
            )}
            <div className="buttons">
              <button type="submit" disabled={pending}>Send</button>
              <button type="button" className="quiet" onClick={cancel} disabled={pending}>Cancel</button>
            </div>
          </form>
        ))}
    </div>
  );
}

function MessageList({ messages, readError }: { messages: ShownMessage[]; readError: string | null }) {
  if (readError !== null) {
    return <p className="error" role="alert">Your messages could not be loaded: {readError}. Try reloading the page.</p>;
  }
  if (!messages.length) {
    return <p className="note" role="status">No messages yet. Messages you send or receive show here.</p>;
  }
  return (
    <ul className="plain message-list">
      {messages.map((m) => (
        <li key={m.id}>
          <details>
            <summary>
              <span className="subject">{m.subject}</span>{" "}
              <span className="note">
                {m.direction === "from" ? `From ${m.other}` : m.direction === "to" ? `To ${m.other}` : "Note to yourself"} · {m.when}
              </span>
            </summary>
            <p className="message-body">{m.body}</p>
          </details>
        </li>
      ))}
    </ul>
  );
}
