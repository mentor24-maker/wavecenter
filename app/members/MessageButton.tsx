"use client";

/**
 * The Message button in a member's row: an envelope that opens a small form
 * (Subject, Message, Send, Cancel) in a dialog. Send saves the message and
 * emails it, on the server (sendMemberMessage). The form says exactly what
 * happened: sent; saved but not emailed, and why; or not sent at all
 * (engineering rule 6). The member's email address never comes to the
 * browser.
 */
import { useRef, useState, useTransition, type FormEvent } from "react";
import { messageProblem } from "../../core/messages.ts";
import { sendMemberMessage } from "./actions";

const UNREACHABLE = "Could not reach WaveCenter, so nothing was sent. Check your connection and try again.";

export default function MessageButton({ memberId, label }: { memberId: string; label: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  // "sent" and "saved" both mean the message is stored, so the form locks:
  // sending again would store it twice.
  const [message, setMessage] = useState<{ kind: "sent" | "saved" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function open() {
    setMessage(null);
    dialog.current?.showModal();
  }

  function close() {
    dialog.current?.close();
    if (message && message.kind !== "error") {
      setSubject("");
      setBody("");
    }
    setMessage(null);
  }

  function send(e: FormEvent) {
    e.preventDefault();
    const problem = messageProblem(subject, body);
    if (problem) {
      setMessage({ kind: "error", text: `Not sent. ${problem}` });
      return;
    }
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await sendMemberMessage(memberId, subject, body);
        if (!result.ok) setMessage({ kind: "error", text: `Not sent. ${result.error}` });
        else if (result.emailed) setMessage({ kind: "sent", text: `Sent. The message is saved and was emailed to ${label}.` });
        else setMessage({ kind: "saved", text: `The message is saved in WaveCenter, but it was not emailed. ${result.reason}` });
      } catch {
        setMessage({ kind: "error", text: UNREACHABLE });
      }
    });
  }

  const done = message !== null && message.kind !== "error";
  return (
    <>
      <button type="button" className="icon-button" aria-label={`Message ${label}`} title="Message" onClick={open}>
        <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M3 6h18v12H3zM3 6l9 7 9-7" />
        </svg>
      </button>
      <dialog ref={dialog} className="message-form" aria-label={`Message ${label}`} onClose={close}>
        <form onSubmit={send}>
          <h2>Message {label}</h2>
          <label>
            Subject
            <input type="text" value={subject} maxLength={200} disabled={pending || done} onChange={(e) => setSubject(e.target.value)} />
          </label>
          <label>
            Message
            <textarea rows={6} value={body} maxLength={10000} disabled={pending || done} onChange={(e) => setBody(e.target.value)} />
          </label>
          {pending && <p className="note" role="status">Sending…</p>}
          {message && (
            <p className={message.kind === "sent" ? "note" : "error"} role={message.kind === "sent" ? "status" : "alert"}>{message.text}</p>
          )}
          <div className="buttons">
            {!done && <button type="submit" disabled={pending}>Send</button>}
            <button type="button" className="quiet" onClick={close} disabled={pending}>{done ? "Close" : "Cancel"}</button>
          </div>
        </form>
      </dialog>
    </>
  );
}
