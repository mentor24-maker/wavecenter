"use client";

/**
 * The chat window itself: the member's chats on the left, the open chat on
 * the right, and the box to type in. On a phone-width screen only one side
 * shows at a time: the list on `/chat`, the open chat on `/chat/<id>`, with
 * a link back to the list.
 *
 * Live (Dane, 2026-11-12: "chat with each other in real-time"): while the
 * window is open it listens, through the one live helper
 * (app/lib/realtimeClient.ts), for any chat message another member sends.
 * Row-level security means it only ever hears about chats this member is in,
 * including a chat someone has just started with them. When one arrives it
 * reloads the page's data, so the server stays the one source of what is
 * shown and every message appears exactly once, in its place. Your own sent
 * message shows the same way, once the save is confirmed. Every time the
 * listen becomes live it reloads once, so nothing said while it was
 * connecting is missed; when it cannot start, is slow, or drops, one plain
 * line says so (rule 7).
 *
 * Messages are plain text, shown as text, never as HTML.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import { CHAT_BODY_MAX, chatMessageProblem, unreadBadge, type ChatMessage } from "../../core/chat.ts";
import { listenToTable, type LiveSettings, type LiveState } from "../lib/realtimeClient";
import { markChatReadNow, sendChat } from "./actions";
import { CHAT_UNREAD_EVENT, listTimeLabel, newestFromOthers, preview, sendsOnKey, sentLabel, type ChatListItem } from "./chatView";

/** The chat the page opened, with its messages oldest first. */
export interface OpenChat {
  id: string;
  otherName: string;
  otherSymbol: string;
  messages: ChatMessage[];
  /** Why its messages could not be read, or null. */
  error: string | null;
}

/** Shown while live updates are not arriving. */
export const CHAT_PAUSED = "Live updates paused, reload to see new messages.";
/** Shown in an open chat with nothing said yet. */
export const NO_MESSAGES = "No messages yet. Say hello below.";
const UNREACHABLE = "Could not reach WaveCenter, so the message was not sent. Check your connection and try again.";

export default function ChatWindow({
  me,
  chats,
  open,
  openProblem,
  openId,
  live,
}: {
  me: string;
  chats: ChatListItem[];
  open: OpenChat | null;
  /** Why the chat in the link could not be opened, or null. */
  openProblem: string | null;
  /** The chat in the link, if any: on a phone, it decides which side shows. */
  openId: string | null;
  /** Where to listen for live updates; null when this deployment has no database settings. */
  live: LiveSettings;
}) {
  const router = useRouter();
  const [liveState, setLiveState] = useState<LiveState>("connecting");

  // The connection follows these strings, not the `live` object, which is new
  // on every server render: depending on it would rejoin on every reload.
  const liveUrl = live?.url ?? null;
  const liveKey = live?.anonKey ?? null;
  useEffect(() => {
    const settings: LiveSettings = liveUrl && liveKey ? { url: liveUrl, anonKey: liveKey } : null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Several messages close together reload once.
    const reload = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 150);
    };
    const stop = listenToTable(settings, {
      table: "chat_messages",
      // Messages from anyone else, in any chat this member may read. Their
      // own messages show when the send is confirmed.
      filter: `sender_id=neq.${me}`,
      onChange: (change) => {
        // Messages are never edited or deleted today; a new one reloads.
        if (change.eventType === "INSERT") reload();
      },
      onState: (state) => {
        setLiveState(state);
        if (state === "live") reload();
      },
    });
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [liveUrl, liveKey, me, router]);

  const showing = openId ? "conversation" : "list";
  return (
    <>
      {liveState === "paused" && <p className="note live-paused" role="status">{CHAT_PAUSED}</p>}
      <div className={`chat-window box showing-${showing}`}>
        <nav className="chat-list" aria-label="Your chats">
          <h2>Your chats</h2>
          {chats.length === 0 ? (
            <p className="note" role="status">
              No chats yet. Start one from <Link href="/members">Members</Link>.
            </p>
          ) : (
            <ul>
              {chats.map((c) => {
                // The open chat is being read right now, so it never shows as unread.
                const isOpen = c.id === openId;
                const badge = isOpen ? null : unreadBadge(c.unread);
                return (
                  <li key={c.id}>
                    <Link
                      href={`/chat/${c.id}`}
                      className={`chat-item${isOpen ? " open" : ""}${badge ? " unread" : ""}`}
                      aria-current={isOpen ? "page" : undefined}
                      aria-label={badge ? `${c.otherName}, ${c.unread} unread ${c.unread === 1 ? "message" : "messages"}` : undefined}
                    >
                      <span className="chat-avatar" aria-hidden="true">{c.otherSymbol}</span>
                      <span className="chat-item-text">
                        <span className="chat-item-top">
                          <b>{c.otherName}</b>
                          <time className="note" dateTime={c.activeAt}>{listTimeLabel(c.activeAt)}</time>
                        </span>
                        <span className="chat-item-bottom">
                          <span className="note chat-preview">
                            {c.last ? `${c.last.mine ? "You: " : ""}${preview(c.last.body)}` : "No messages yet"}
                          </span>
                          {badge && <span className="unread-badge" aria-hidden="true">{badge}</span>}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>

        <section className="chat-conversation" aria-label={open ? `Chat with ${open.otherName}` : "Open chat"}>
          <p className="chat-back"><Link href="/chat">&larr; All chats</Link></p>
          {openProblem ? (
            <p className="error" role="alert">{openProblem}</p>
          ) : !open ? (
            <p className="note" role="status">
              {chats.length ? "Pick a chat from the list to read it." : "When you start a chat, it opens here."}
            </p>
          ) : (
            <Conversation key={open.id} me={me} chat={open} />
          )}
        </section>
      </div>
    </>
  );
}

function Conversation({ me, chat }: { me: string; chat: OpenChat }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const sending = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);

  // Keep the newest message in view as messages arrive.
  const count = chat.messages.length;
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [count]);

  // Opening the chat marks it read, and so does each new message from the
  // other member while it is open and on screen (WC-176). In a hidden tab it
  // waits until the tab is shown again. Then the header's badge counts again.
  const [readProblem, setReadProblem] = useState<string | null>(null);
  const newest = newestFromOthers(chat.messages, me);
  const shown = chat.error === null;
  useEffect(() => {
    if (!shown) return;
    let done = false;
    let gone = false;
    const mark = () => {
      if (done || document.visibilityState !== "visible") return;
      done = true;
      markChatReadNow(chat.id)
        .then((r) => {
          if (gone) return;
          setReadProblem(r.ok ? null : r.error);
          if (r.ok) window.dispatchEvent(new Event(CHAT_UNREAD_EVENT));
        })
        .catch(() => {
          if (!gone) setReadProblem("Could not reach WaveCenter to mark this chat read.");
        });
    };
    mark();
    document.addEventListener("visibilitychange", mark);
    return () => {
      gone = true;
      document.removeEventListener("visibilitychange", mark);
    };
  }, [chat.id, newest, shown]);

  function send(e?: FormEvent) {
    e?.preventDefault();
    if (sending.current) return;
    const problem = chatMessageProblem(text);
    if (problem) {
      setFailure(`Not sent. ${problem}`);
      return;
    }
    const body = text;
    sending.current = true;
    setFailure(null);
    startTransition(async () => {
      try {
        const result = await sendChat(chat.id, body);
        if (!result.ok) {
          // The text stays in the box, so nothing typed is lost.
          setFailure(`Not sent. ${result.error}`);
          return;
        }
        // Saved: empty the box only if nothing new was typed meanwhile.
        setText((now) => (now === body ? "" : now));
        router.refresh();
      } catch {
        setFailure(UNREACHABLE);
      } finally {
        sending.current = false;
      }
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (sendsOnKey({ key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing })) {
      e.preventDefault();
      send();
    }
  }

  return (
    <>
      <h2 className="chat-with">
        <span aria-hidden="true">{chat.otherSymbol}</span> {chat.otherName}
      </h2>
      <div className="chat-messages box" aria-live="polite">
        {chat.error !== null ? (
          <p className="error" role="alert">The messages could not be loaded: {chat.error}. Nothing has been lost; try reloading the page.</p>
        ) : chat.messages.length === 0 ? (
          <p className="note" role="status">{NO_MESSAGES}</p>
        ) : (
          <ol>
            {chat.messages.map((m) => {
              const mine = m.senderId === me;
              return (
                <li key={m.id} className={mine ? "chat-message mine" : "chat-message"}>
                  <span className="chat-meta note">
                    <b>{mine ? "You" : chat.otherName}</b> · <time dateTime={m.sentAt}>{sentLabel(m.sentAt)}</time>
                  </span>
                  <span className="chat-body">{m.body}</span>
                </li>
              );
            })}
          </ol>
        )}
        <div ref={bottom} />
      </div>
      {readProblem && <p className="note" role="status">This chat could not be marked read, so it may still show as unread: {readProblem}</p>}
      <form className="chat-send" onSubmit={send}>
        <label className="sr-only" htmlFor={`chat-box-${chat.id}`}>Message {chat.otherName}</label>
        <textarea
          id={`chat-box-${chat.id}`}
          rows={2}
          value={text}
          maxLength={CHAT_BODY_MAX + 200}
          placeholder={`Message ${chat.otherName}`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button type="submit" disabled={pending}>{pending ? "Sending…" : "Send"}</button>
        <p className="note chat-hint">Enter sends; Shift+Enter makes a new line.</p>
        {failure && <p className="error" role="alert">{failure}</p>}
      </form>
    </>
  );
}
