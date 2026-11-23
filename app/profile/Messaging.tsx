"use client";

/**
 * The Messaging section of Your profile: a Send Message block, folded shut
 * until clicked, and the Messages table (WC-180): the messages the member
 * sent or received, with Direction, Member, Subject, Sent and Actions
 * columns, headings that sort when clicked (newest first to start), and a
 * filter bar. A message's subject opens its text. The Actions column holds
 * Reply (opens Send Message addressed back, with a "Re:" subject), Star and
 * Trash.
 *
 * Star and Trash are private to the member who clicks them (Dane's "A",
 * 2026-11-22): a Star marks a message as important to them ("Flag is
 * intended to mean as 'important', not 'bad'"), and Trash hides it from
 * their own table until they tick Show trash and restore it. Neither changes
 * the message or what the other member sees. Each click shows at once; if
 * the save fails, the row says so and goes back as it was (engineering
 * rule 6).
 *
 * Sending goes through the same server action as the Members page's Message
 * button (sendMemberMessage), so it saves and emails the same way, and the
 * form says exactly what happened: sent; saved but not emailed, and why; or
 * not sent at all (engineering rule 6). After a save the page reloads its
 * messages, so the new one shows in Messages. No email address ever comes to
 * the browser: members are named only as their profile allows. Filtering and
 * sorting work on the messages already loaded (messageView.ts).
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { messageProblem, type MarkChange } from "../../core/messages.ts";
import { sendMemberMessage } from "../members/actions";
import { markMyMessage } from "./actions";
import {
  DEFAULT_MESSAGE_SORT,
  NO_MESSAGE_FILTER,
  directionLabel,
  filterMessages,
  isFiltering,
  nextSort,
  replySubject,
  sortMessages,
  trashCount,
  type MessageFilter,
  type MessageSort,
  type MessageSortKey,
  type ViewMessage,
} from "./messageView";

export interface ShownMessage extends ViewMessage {
  /** The other member's id, for Reply. Your own on a note to yourself. */
  otherId: string;
  /** When it was sent, in Mountain time. */
  when: string;
}

export interface Recipient {
  memberId: string;
  label: string;
}

/** What Reply fills into Send Message. `n` changes on every Reply, so the form starts fresh each time. */
interface Draft {
  n: number;
  to: string;
  subject: string;
}

const UNREACHABLE = "Could not reach WaveCenter, so nothing was sent. Check your connection and try again.";

export default function Messaging({
  messages,
  readError,
  marksError,
  recipients,
  sendBlocked,
}: {
  messages: ShownMessage[];
  /** Why the messages could not be read, or null if they were. */
  readError: string | null;
  /** Why the member's stars and trash could not be read, or null if they were. */
  marksError: string | null;
  recipients: Recipient[];
  /** Why this member cannot send, in plain words, or null if they can. */
  sendBlocked: string | null;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const reply = (m: ShownMessage) => setDraft({ n: (draft?.n ?? 0) + 1, to: m.otherId, subject: replySubject(m.subject) });
  return (
    <section className="panel messaging" aria-labelledby="messaging-heading">
      <h2 id="messaging-heading">Messaging</h2>
      <SendMessage key={draft?.n ?? 0} recipients={recipients} blocked={sendBlocked} draft={draft} />
      <h3>Messages</h3>
      <MessageTable messages={messages} readError={readError} marksError={marksError} onReply={reply} />
    </section>
  );
}

function SendMessage({ recipients, blocked, draft }: { recipients: Recipient[]; blocked: string | null; draft: Draft | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(draft !== null);
  const [to, setTo] = useState(draft?.to ?? "");
  const [subject, setSubject] = useState(draft?.subject ?? "");
  const block = useRef<HTMLDivElement>(null);

  // A Reply opens this block filled in: bring it into view.
  useEffect(() => {
    if (draft) block.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [draft]);
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
    <div className="send-message" ref={block}>
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
              <textarea rows={5} value={body} autoFocus={draft !== null} maxLength={10000} disabled={pending} onChange={(e) => setBody(e.target.value)} />
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

const ICON_PATHS = {
  reply: "M10 8L4 13l6 5M4 13h10a6 6 0 0 1 6 6v1",
  star: "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6",
};

function Icon({ name, filled = false }: { name: keyof typeof ICON_PATHS; filled?: boolean }) {
  return (
    <svg className={filled ? "icon filled" : "icon"} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

type Marks = Pick<ViewMessage, "starred" | "trashed">;

function MessageTable({
  messages,
  readError,
  marksError,
  onReply,
}: {
  messages: ShownMessage[];
  readError: string | null;
  marksError: string | null;
  onReply: (m: ShownMessage) => void;
}) {
  const [sort, setSort] = useState<MessageSort>(DEFAULT_MESSAGE_SORT);
  const [filter, setFilter] = useState<MessageFilter>(NO_MESSAGE_FILTER);
  // What each click shows at once, by message id, until the page reloads its marks.
  const [marks, setMarks] = useState<Record<string, Marks>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});

  if (readError !== null) {
    return <p className="error" role="alert">Your messages could not be loaded: {readError}. Try reloading the page.</p>;
  }
  if (!messages.length) {
    return <p className="note" role="status">No messages yet. Messages you send or receive show here.</p>;
  }

  const all = messages.map((m) => ({ ...m, ...marks[m.id] }));
  const shown = filterMessages(sortMessages(all, sort), filter);
  const inTrash = trashCount(all);
  const filtering = isFiltering(filter);

  async function mark(m: ShownMessage, change: MarkChange) {
    const before: Marks = { starred: m.starred, trashed: m.trashed };
    const after: Marks = { starred: change.starred ?? m.starred, trashed: change.trashed ?? m.trashed };
    setMarks((x) => ({ ...x, [m.id]: after }));
    setSaving((x) => ({ ...x, [m.id]: true }));
    setRowError((x) => ({ ...x, [m.id]: "" }));
    const what = change.starred !== undefined ? (change.starred ? "starred" : "unstarred") : change.trashed ? "moved to your trash" : "restored";
    let error: string | null = null;
    try {
      const result = await markMyMessage(m.id, change);
      if (result.ok) setMarks((x) => ({ ...x, [m.id]: { starred: result.mark.starred, trashed: result.mark.trashedAt !== null } }));
      else error = result.error;
    } catch {
      error = "Could not reach WaveCenter. Check your connection and try again.";
    }
    if (error !== null) {
      setMarks((x) => ({ ...x, [m.id]: before }));
      setRowError((x) => ({ ...x, [m.id]: `Not ${what}. ${error}` }));
    }
    setSaving((x) => ({ ...x, [m.id]: false }));
  }

  const sortHeading = (key: MessageSortKey, label: string) => {
    const on = sort.key === key;
    return (
      <th scope="col" aria-sort={on ? (sort.ascending ? "ascending" : "descending") : "none"}>
        <button type="button" className="sort" onClick={() => setSort(nextSort(sort, key))}>
          {label}
          <span aria-hidden="true" className="arrow">{on ? (sort.ascending ? "▲" : "▼") : ""}</span>
        </button>
      </th>
    );
  };

  // Why the table is empty, in plain words (engineering rule 7).
  const emptyWhy = filtering
    ? "No message matches these filters."
    : inTrash > 0 && !filter.showTrash
      ? `Every message is in your trash (${inTrash}). Tick Show trash to see them.`
      : "No message to show.";

  return (
    <>
      {marksError !== null && (
        <p className="error" role="alert">
          Your stars and trash could not be loaded: {marksError}. Every message shows unstarred and out of the trash, and Star and Trash are off until you reload the page.
        </p>
      )}
      <form className="filters" aria-label="Filter messages" onSubmit={(e) => e.preventDefault()}>
        <input
          type="search"
          aria-label="Filter by member, subject or text"
          placeholder="Filter messages"
          value={filter.text}
          onChange={(e) => setFilter({ ...filter, text: e.target.value })}
        />
        <select
          aria-label="Filter by direction"
          value={filter.direction}
          onChange={(e) => setFilter({ ...filter, direction: e.target.value as MessageFilter["direction"] })}
        >
          <option value="all">All messages</option>
          <option value="received">Received</option>
          <option value="sent">Sent</option>
        </select>
        <label className="check">
          <input type="checkbox" checked={filter.starredOnly} onChange={(e) => setFilter({ ...filter, starredOnly: e.target.checked })} />
          Starred only
        </label>
        <label className="check">
          <input type="checkbox" checked={filter.showTrash} onChange={(e) => setFilter({ ...filter, showTrash: e.target.checked })} />
          Show trash{inTrash > 0 ? ` (${inTrash})` : ""}
        </label>
        {(filtering || filter.showTrash) && (
          <button type="button" className="link" onClick={() => setFilter(NO_MESSAGE_FILTER)}>Clear filters</button>
        )}
      </form>
      {filtering && (
        <p className="note" role="status">Showing {shown.length} of {all.length - (filter.showTrash ? 0 : inTrash)} messages.</p>
      )}

      <div className="table-scroll">
        <table className="game members messages">
          <thead>
            <tr>
              <th scope="col">Direction</th>
              {sortHeading("member", "Member")}
              {sortHeading("subject", "Subject")}
              {sortHeading("sent", "Sent")}
              <th scope="col" className="actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <span className="note" role="status">{emptyWhy} </span>
                  {filtering && (
                    <button type="button" className="link" onClick={() => setFilter({ ...NO_MESSAGE_FILTER, showTrash: filter.showTrash })}>
                      Clear the filters
                    </button>
                  )}
                </td>
              </tr>
            ) : (
              shown.map((m) => {
                const busy = saving[m.id] === true || marksError !== null;
                const about = `“${m.subject}”`;
                return (
                  <tr key={m.id} className={m.trashed ? "trashed" : undefined}>
                    <td className="note">{directionLabel(m.direction)}</td>
                    <td>{m.direction === "self" ? <span className="note">You</span> : m.other}</td>
                    <td className="message-subject">
                      <details>
                        <summary>
                          {m.starred && <span className="star-mark" role="img" aria-label="Starred">★ </span>}
                          <span className="subject">{m.subject}</span>
                          {m.trashed && <span className="note"> (in your trash)</span>}
                        </summary>
                        <p className="message-body">{m.body}</p>
                      </details>
                      {rowError[m.id] && <p className="error" role="alert">{rowError[m.id]}</p>}
                    </td>
                    <td className="note sent">{m.when}</td>
                    <td className="member-actions">
                      {m.direction !== "self" && (
                        <button type="button" className="icon-button" aria-label={`Reply to ${about}`} title="Reply" onClick={() => onReply(m)}>
                          <Icon name="reply" />
                        </button>
                      )}
                      <button
                        type="button"
                        className={m.starred ? "icon-button starred" : "icon-button"}
                        aria-label={`Star ${about}`}
                        aria-pressed={m.starred}
                        title={m.starred ? "Starred: click to unstar" : "Star: mark as important"}
                        disabled={busy}
                        onClick={() => mark(m, { starred: !m.starred })}
                      >
                        <Icon name="star" filled={m.starred} />
                      </button>
                      {m.trashed ? (
                        <button type="button" className="link" disabled={busy} onClick={() => mark(m, { trashed: false })} aria-label={`Restore ${about} from your trash`}>
                          Restore
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="icon-button danger"
                          aria-label={`Move ${about} to your trash`}
                          title="Trash: hide from your messages (you can restore it)"
                          disabled={busy}
                          onClick={() => mark(m, { trashed: true })}
                        >
                          <Icon name="trash" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
