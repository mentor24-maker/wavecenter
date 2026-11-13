"use client";

/**
 * "Chat about this task", beside a task's details (Dane, 2026-11-12: "Chat's
 * next to and about tasks would be ideal"; "Any two members, for now").
 *
 * The member picks anyone (the task's maker is offered first) and starts or
 * reopens their private chat about this task (startChatWith, on the server).
 * Their own chats about this task are listed; opening one shows it live in
 * the panel, with the same conversation the chat window uses
 * (app/chat/ChatWindow.tsx). The open chat is in the link (`?chat=<id>`), so
 * a reload keeps it open.
 *
 * Private: the page reads chats through the member's own session, so
 * row-level security only ever hands back chats they are in. Another member
 * on this page sees their own chats, never these, and no sign of them.
 * Every empty or failed part says why (rules 6 and 7).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import type { LiveSettings } from "../../lib/realtimeClient";
import { startChatWith } from "../../chat/actions";
import { CHAT_PAUSED, Conversation, useChatLive, type OpenChat } from "../../chat/ChatWindow";
import { listTimeLabel, preview, type ChatListItem } from "../../chat/chatView";

/** A member the panel offers to chat with. */
export interface ChatPartnerOption {
  id: string;
  name: string;
  /** The task's maker: offered first. */
  isMaker: boolean;
}

/** Shown when the member has no private chat about this task. */
export const NO_TASK_CHATS = "No private chats about this task yet.";
/** Says who can see a chat here, to tell it apart from the public Discussion. */
export const TASK_CHATS_PRIVATE = "Only the two members in a chat can see it. To talk with everyone, use the Discussion below.";
const UNREACHABLE = "Could not reach WaveCenter, so no chat was started. Check your connection and try again.";

export default function TaskChats({
  me,
  taskId,
  partners,
  partnersError,
  chats,
  chatsError,
  open,
  openProblem,
  live,
}: {
  me: string;
  taskId: string;
  /** Everyone the member may chat with, the task's maker first. */
  partners: ChatPartnerOption[];
  /** Why the members could not be listed, or null. */
  partnersError: string | null;
  /** The member's own chats about this task. */
  chats: ChatListItem[];
  /** Why those chats could not be read, or null. */
  chatsError: string | null;
  /** The chat in the link, open in the panel. */
  open: OpenChat | null;
  /** Why the chat in the link could not be opened, or null. */
  openProblem: string | null;
  live: LiveSettings;
}) {
  const router = useRouter();
  const liveState = useChatLive(me, live);
  const [partner, setPartner] = useState(partners[0]?.id ?? "");
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function start(e: FormEvent) {
    e.preventDefault();
    if (!partner) {
      setFailure("Pick a member to chat with first.");
      return;
    }
    setFailure(null);
    startTransition(async () => {
      try {
        const result = await startChatWith(partner, taskId);
        if (!result.ok) {
          setFailure(`No chat was started. ${result.error}`);
          return;
        }
        router.push(`/tasks/${taskId}?chat=${result.id}`, { scroll: false });
        router.refresh();
      } catch {
        setFailure(UNREACHABLE);
      }
    });
  }

  return (
    <aside className="task-chats box" aria-label="Chat about this task">
      <h2>Chat about this task</h2>
      <p className="note">{TASK_CHATS_PRIVATE}</p>
      {liveState === "paused" && <p className="note live-paused" role="status">{CHAT_PAUSED}</p>}

      {partnersError !== null ? (
        <p className="error" role="alert">The members could not be listed, so no chat can be started right now: {partnersError}. Try reloading the page.</p>
      ) : partners.length === 0 ? (
        <p className="note" role="status">There is nobody else to chat with yet: you are the only member.</p>
      ) : (
        <form className="task-chat-start" onSubmit={start}>
          <label htmlFor="task-chat-partner">Chat with</label>
          <select id="task-chat-partner" value={partner} onChange={(e) => setPartner(e.target.value)}>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>{p.isMaker ? `${p.name} (made this task)` : p.name}</option>
            ))}
          </select>
          <button type="submit" disabled={pending}>{pending ? "Starting…" : "Start chat"}</button>
          {failure && <p className="error" role="alert">{failure}</p>}
        </form>
      )}

      <h3>Your private chats about this task</h3>
      {chatsError !== null ? (
        <p className="error" role="alert">Your chats about this task could not be loaded: {chatsError}. Nothing has been lost; try reloading the page.</p>
      ) : chats.length === 0 ? (
        <p className="note" role="status">{NO_TASK_CHATS}</p>
      ) : (
        <ul className="task-chat-list">
          {chats.map((c) => (
            <li key={c.id}>
              <Link
                href={`/tasks/${taskId}?chat=${c.id}`}
                scroll={false}
                className={c.id === open?.id ? "chat-item open" : "chat-item"}
                aria-current={c.id === open?.id ? "true" : undefined}
              >
                <span className="chat-avatar" aria-hidden="true">{c.otherSymbol}</span>
                <span className="chat-item-text">
                  <span className="chat-item-top">
                    <b>{c.otherName}</b>
                    <time className="note" dateTime={c.activeAt}>{listTimeLabel(c.activeAt)}</time>
                  </span>
                  <span className="note chat-preview">
                    {c.last ? `${c.last.mine ? "You: " : ""}${preview(c.last.body)}` : "No messages yet"}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {openProblem && <p className="error" role="alert">{openProblem}</p>}
      {open && (
        <div className="task-chat-open">
          <Conversation key={open.id} me={me} chat={open} showTopic={false} />
          <p className="note"><Link href={`/chat/${open.id}`}>Open in Chat</Link> · <Link href={`/tasks/${taskId}`} scroll={false}>Close</Link></p>
        </div>
      )}
    </aside>
  );
}
