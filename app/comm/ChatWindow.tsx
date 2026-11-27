"use client";

/**
 * The chat window itself: the member's chats on the left, the open chat on
 * the right, and the box to type in. On a phone-width screen only one side
 * shows at a time: the list on `/comm`, the open chat on `/comm/<id>`, with
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
 * Talk to anyone from here (WC-235): a contact selector on top of the chat
 * area picks a member and opens your chat with them, or starts one, through
 * the same startChatWith action as the Members page's Chat button, so
 * picking someone you already chat with never makes a second chat. The open
 * chat shows its newest message on top, under the send box, with older ones
 * scrolling off the bottom, and a search field finds messages by the words
 * in them.
 *
 * Messages are plain text, shown as text, never as HTML.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import { CHAT_BODY_MAX, chatMessageProblem, unreadBadge, type ChatMessage } from "../../core/chat.ts";
import { listenToTable, type LiveSettings, type LiveState } from "../lib/realtimeClient";
import { markChatReadNow, sendChat, startChatWith } from "./actions";
import {
  A_TASK,
  CHAT_UNREAD_EVENT,
  clockLabel,
  DELETED_TASK,
  isSearching,
  listTimeLabel,
  matchCountLine,
  newestFirst,
  newestFromOthers,
  noMatchLine,
  notStarted,
  preview,
  searchMessages,
  sendsOnKey,
  sentLabel,
  withDayBreaks,
  type ChatListItem,
  type ChatPartnerOption,
  type ChatTopic,
} from "./chatView";

/** The chat the page opened, with its messages oldest first. */
export interface OpenChat {
  id: string;
  /** The task it is about, if any. */
  topic: ChatTopic;
  otherName: string;
  otherSymbol: string;
  messages: ChatMessage[];
  /** Why its messages could not be read, or null. */
  error: string | null;
}

/** Shown while live updates are not arriving. */
export const CHAT_PAUSED = "Live updates paused, reload to see new messages.";
/** Shown in an open chat with nothing said yet, when the send box is under the messages. */
export const NO_MESSAGES = "No messages yet. Say hello below.";
/** The same, when the send box is on top (the Sync mode's chat window). */
export const NO_MESSAGES_ABOVE = "No messages yet. Say hello above.";
/** The contact selector when there is nobody else to pick (rule 7). */
export const NO_PARTNERS = "There is nobody else to chat with yet: you are the only member.";
const UNREACHABLE = "Could not reach WaveCenter, so the message was not sent. Check your connection and try again.";
const START_UNREACHABLE = "Could not reach WaveCenter, so no chat was started. Check your connection and try again.";

export default function ChatWindow({
  me,
  chats,
  open,
  openProblem,
  openId,
  live,
  partners,
  partnersError,
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
  /** The members the contact selector offers: everyone but the viewer. */
  partners: ChatPartnerOption[];
  /** Why the members could not be listed, or null. */
  partnersError: string | null;
}) {
  const liveState = useChatLive(me, live);

  const showing = openId ? "conversation" : "list";
  return (
    <>
      {liveState === "paused" && <p className="note live-paused" role="status">{CHAT_PAUSED}</p>}
      <div className={`chat-window box showing-${showing}`}>
        <nav className="chat-list" aria-label="Your chats">
          <h2>Your chats</h2>
          {chats.length === 0 ? (
            <p className="note" role="status">
              No chats yet. Pick a member under &quot;Chat with&quot; to start one, or start one from <Link href="/members">Members</Link>.
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
                      href={`/comm/${c.id}`}
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
                        {c.topic && <span className="note chat-topic">{topicText(c.topic)}</span>}
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
          <p className="chat-back"><Link href="/comm">&larr; All chats</Link></p>
          <ContactPicker partners={partners} problem={partnersError} />
          {openProblem ? (
            <p className="error" role="alert">{openProblem}</p>
          ) : !open ? (
            <p className="note" role="status">
              {chats.length ? "Pick a chat from the list to read it, or pick a member above." : "Pick a member above to start a chat; it opens here."}
            </p>
          ) : (
            <Conversation key={open.id} me={me} chat={open} newestOnTop searchable />
          )}
        </section>
      </div>
    </>
  );
}

/**
 * The contact selector on top of the Sync mode's chat area (WC-235): pick a
 * member and open your chat with them, or start one, at `/comm/<id>`. One
 * member per chat for now (Dane: "we can address multiple members later").
 * It says why when the members cannot be listed or there is nobody else
 * (rule 7), and a failed start says so and opens nothing (rule 6).
 */
function ContactPicker({ partners, problem }: { partners: ChatPartnerOption[]; problem: string | null }) {
  const router = useRouter();
  const [partner, setPartner] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (problem !== null) {
    return <p className="error chat-picker" role="alert">The members could not be listed, so no new chat can be started here right now: {problem}. Try reloading the page.</p>;
  }
  if (partners.length === 0) return <p className="note chat-picker" role="status">{NO_PARTNERS}</p>;

  function start(e: FormEvent) {
    e.preventDefault();
    if (!partner) {
      setFailure("No chat was started. Pick a member first.");
      return;
    }
    setFailure(null);
    startTransition(async () => {
      try {
        const result = await startChatWith(partner);
        if (!result.ok) {
          setFailure(notStarted(result.error));
          return;
        }
        setPartner("");
        router.push(`/comm/${result.id}`);
      } catch {
        setFailure(START_UNREACHABLE);
      }
    });
  }

  return (
    <form className="chat-picker task-chat-start" onSubmit={start}>
      <label htmlFor="chat-partner">Chat with</label>
      <select id="chat-partner" value={partner} onChange={(e) => setPartner(e.target.value)}>
        <option value="">Pick a member…</option>
        {partners.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      <button type="submit" disabled={pending}>{pending ? "Opening…" : "Open chat"}</button>
      {failure && <p className="error" role="alert">{failure}</p>}
    </form>
  );
}

/**
 * One open chat: its messages and the box to send from. Used by the chat
 * window and by the task page's "Chat about this task" panel
 * (app/tasks/[id]/TaskChats.tsx), which hides the task line (`showTopic`)
 * because the task is the page itself.
 *
 * By default the messages run oldest first with the send box under them
 * (the task page). `newestOnTop` (the Sync mode's window, WC-235) puts the
 * send box on top and the newest message right under it, older ones
 * scrolling off the bottom. `searchable` adds a field that shows only the
 * messages holding the words typed.
 */
export function Conversation({
  me,
  chat,
  showTopic = true,
  newestOnTop = false,
  searchable = false,
}: {
  me: string;
  chat: OpenChat;
  showTopic?: boolean;
  newestOnTop?: boolean;
  searchable?: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const sending = useRef(false);
  const box = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState("");
  const searching = searchable && isSearching(query);
  const ordered = newestOnTop ? newestFirst(chat.messages) : chat.messages;
  const shownMessages = searching ? searchMessages(ordered, query) : ordered;

  // Keep the newest message in view as messages arrive, by scrolling the
  // messages box itself: to the top when the newest is on top, else to the
  // bottom. Never scrollIntoView: that scrolls the whole page too, and on
  // the task page it threw the reader back to the top whenever a message
  // arrived (WC-175 review).
  const count = chat.messages.length;
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = newestOnTop ? 0 : el.scrollHeight;
  }, [count, newestOnTop]);

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

  const sendForm = (
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
  );
  const readLine = readProblem && <p className="note" role="status">This chat could not be marked read, so it may still show as unread: {readProblem}</p>;

  return (
    <>
      <h2 className="chat-with">
        <span aria-hidden="true">{chat.otherSymbol}</span> {chat.otherName}
      </h2>
      {showTopic && chat.topic && <TopicLine topic={chat.topic} />}
      {newestOnTop && sendForm}
      {searchable && chat.error === null && chat.messages.length > 0 && (
        <div className="chat-search">
          <label htmlFor={`chat-search-${chat.id}`}>Search this chat</label>
          <input
            id={`chat-search-${chat.id}`}
            type="search"
            value={query}
            placeholder="Words in a message"
            onChange={(e) => setQuery(e.target.value)}
          />
          {/* No match says so once, in the messages box below. */}
          {searching && shownMessages.length > 0 && <p className="note" role="status">{matchCountLine(shownMessages.length, chat.messages.length, query)}</p>}
        </div>
      )}
      {newestOnTop && readLine}
      <div ref={box} className={`chat-messages box${newestOnTop ? " newest-on-top" : ""}`} aria-live="polite">
        {chat.error !== null ? (
          <p className="error" role="alert">The messages could not be loaded: {chat.error}. Nothing has been lost; try reloading the page.</p>
        ) : chat.messages.length === 0 ? (
          <p className="note" role="status">{newestOnTop ? NO_MESSAGES_ABOVE : NO_MESSAGES}</p>
        ) : shownMessages.length === 0 ? (
          <p className="note" role="status">{noMatchLine(query)}</p>
        ) : (
          <ol>
            {withDayBreaks(shownMessages).map(({ day, message: m }) => {
              const mine = m.senderId === me;
              return (
                <Fragment key={m.id}>
                  {day && (
                    <li className="chat-day-break" role="separator" aria-label={day.label}>
                      <span className="chat-day-label">{day.label}</span>
                    </li>
                  )}
                  <li className={mine ? "chat-message mine" : "chat-message"}>
                    <span className="chat-meta note">
                      <b>{mine ? "You" : chat.otherName}</b> · <time dateTime={m.sentAt} title={sentLabel(m.sentAt)}>{clockLabel(m.sentAt)}</time>
                    </span>
                    <span className="chat-body">{m.body}</span>
                  </li>
                </Fragment>
              );
            })}
          </ol>
        )}
      </div>
      {!newestOnTop && readLine}
      {!newestOnTop && sendForm}
    </>
  );
}

/** The list's short words for what a chat is about. */
function topicText(topic: NonNullable<ChatTopic>): string {
  return topic.kind === "task" ? `About: ${topic.title ?? A_TASK}` : DELETED_TASK;
}

/** Under an open chat's name: the task it is about, linked, or that the task was deleted. */
function TopicLine({ topic }: { topic: NonNullable<ChatTopic> }) {
  return (
    <p className="note chat-topic-line">
      {topic.kind === "task" ? (
        <>About <Link href={`/tasks/${topic.taskId}`}>{topic.title ?? A_TASK}</Link></>
      ) : (
        <>This chat was {DELETED_TASK}.</>
      )}
    </p>
  );
}

/**
 * Listen live for chat messages from anyone else in any chat this member is
 * in, through the one live helper (app/lib/realtimeClient.ts), and reload the
 * page's data when one arrives, so the server stays the one source of what is
 * shown. Every time the listen becomes live it reloads once, so nothing said
 * while it was connecting is missed. Returns the listen's state, for the
 * "paused" line (rule 7). Used by the chat window and the task page's panel.
 */
export function useChatLive(me: string, live: LiveSettings): LiveState {
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

  return liveState;
}
