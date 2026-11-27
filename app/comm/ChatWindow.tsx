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
 * picking someone you already chat with never makes a second chat. Ticking
 * several members starts a group chat (WC-252); ticking the same set again
 * opens the group already there. A group chat is named by all its other
 * members, and each of its messages names who sent it. The open
 * chat shows its newest message on top, under the send box, with older ones
 * scrolling off the bottom, and a search field finds messages by the words
 * in them.
 *
 * From and To days (WC-245, moved beside "Chat with" by WC-253) narrow what
 * shows to what happened on those Mountain-time days, and a toggle chooses
 * what they narrow (Dane: "C) Provide a toggle"): the open chat's messages,
 * the chat list by each chat's latest activity, or both. Nothing is read
 * again: they hide what the page already has. Comm's layout holds them, so
 * they stay put while the member opens one chat after another.
 *
 * Messages are plain text, shown as text, never as HTML.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import { CHAT_BODY_MAX, CHAT_MEMBERS_MAX, chatMessageProblem, startChatProblem, unreadBadge, type ChatMessage } from "../../core/chat.ts";
import { listenToTable, type LiveSettings, type LiveState } from "../lib/realtimeClient";
import { addToChat, markChatReadNow, sendChat, startChatWith } from "./actions";
import { useCommDates } from "./CommDates";
import {
  A_TASK,
  addableMembers,
  CHAT_UNREAD_EVENT,
  clockLabel,
  DELETED_TASK,
  ANY_DATE,
  backwardsRangeLine,
  chatCountLine,
  chatsInRange,
  DATES_APPLY_TO,
  datesNarrowChats,
  datesNarrowMessages,
  noChatsLine,
  type DatesApplyTo,
  isDateFiltering,
  isRangeBackwards,
  isSearching,
  messagesInRange,
  type DateRange,
  listTimeLabel,
  matchCountLine,
  newestFirst,
  newestFromOthers,
  noMatchLine,
  notAdded,
  notStarted,
  preview,
  namesInWords,
  searchMessages,
  senderName,
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
  /** The other member's name, or in a group every other member's. */
  otherName: string;
  otherSymbol: string;
  /** A group chat (WC-252): each message then names its sender. Absent: two members. */
  group?: boolean;
  /** Each other member's id to their name, for naming senders in a group. */
  senderNames?: Record<string, string>;
  /** Everyone in it, the viewer included (WC-256: who "Add someone" leaves out). Absent: no adding here. */
  memberIds?: string[];
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
const ADD_UNREACHABLE = "Could not reach WaveCenter, so nobody was added. Check your connection and try again.";
/** The "Add someone" picker when everyone else is already in the chat (rule 7). */
export const EVERYONE_IN_CHAT = "Everyone else is already in this chat.";

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
  // WC-253: the From and To days ("YYYY-MM-DD", or "" for no limit) and what
  // they narrow, held by Comm's layout so opening a chat keeps them (CommDates.tsx).
  const { range, setRange, applyTo, setApplyTo } = useCommDates();
  const dating = isDateFiltering(range);
  const backwards = dating && isRangeBackwards(range);
  const listDating = dating && datesNarrowChats(applyTo);
  const shownChats = !listDating ? chats : backwards ? [] : chatsInRange(chats, range);

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
          ) : listDating && backwards ? (
            <p className="note" role="status">{backwardsRangeLine(range, undefined, "chat")}</p>
          ) : shownChats.length === 0 ? (
            <p className="note" role="status">{noChatsLine(range)}</p>
          ) : (
            <>
            {listDating && shownChats.length < chats.length && <p className="note chat-list-count" role="status">{chatCountLine(shownChats.length, chats.length, range)}</p>}
            <ul>
              {shownChats.map((c) => {
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
            </>
          )}
        </nav>

        <section className="chat-conversation" aria-label={open ? `Chat with ${open.otherName}` : "Open chat"}>
          <p className="chat-back"><Link href="/comm">&larr; All chats</Link></p>
          {/* WC-253: one row: From, To, what they narrow, then "Chat with". */}
          <div className="chat-top-row">
            <DateFilter range={range} onRange={setRange} applyTo={applyTo} onApplyTo={setApplyTo} />
            <ContactPicker me={me} partners={partners} problem={partnersError} />
          </div>
          {openProblem ? (
            <p className="error" role="alert">{openProblem}</p>
          ) : !open ? (
            <p className="note" role="status">
              {chats.length ? "Pick a chat from the list to read it, or pick a member above." : "Pick a member above to start a chat; it opens here."}
            </p>
          ) : (
            <Conversation
              key={open.id}
              me={me}
              chat={open}
              newestOnTop
              searchable
              range={datesNarrowMessages(applyTo) ? range : ANY_DATE}
              addFrom={{ partners, problem: partnersError }}
            />
          )}
        </section>
      </div>
    </>
  );
}

/**
 * The From and To days and the toggle choosing what they narrow (WC-253),
 * to the left of "Chat with". Emptying both days, or "Clear dates", shows
 * everything again.
 */
function DateFilter({
  range,
  onRange,
  applyTo,
  onApplyTo,
}: {
  range: DateRange;
  onRange: (update: (r: DateRange) => DateRange) => void;
  applyTo: DatesApplyTo;
  onApplyTo: (value: DatesApplyTo) => void;
}) {
  return (
    <div className="chat-dates" role="group" aria-label="Dates">
      <span className="chat-date">
        <label htmlFor="chat-from">From:</label>
        <input id="chat-from" type="date" value={range.from} onChange={(e) => onRange((r) => ({ ...r, from: e.target.value }))} />
      </span>
      <span className="chat-date">
        <label htmlFor="chat-to">To:</label>
        <input id="chat-to" type="date" value={range.to} onChange={(e) => onRange((r) => ({ ...r, to: e.target.value }))} />
      </span>
      <span className="chat-date">
        <label htmlFor="chat-dates-apply">Dates filter</label>
        <select id="chat-dates-apply" value={applyTo} onChange={(e) => onApplyTo(e.target.value as DatesApplyTo)}>
          {DATES_APPLY_TO.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </span>
      {isDateFiltering(range) && (
        <button type="button" className="link chat-dates-clear" onClick={() => onRange(() => ANY_DATE)}>Clear dates</button>
      )}
    </div>
  );
}

/**
 * The contact selector on top of the Sync mode's chat area (WC-235): tick
 * one member, or several for a group chat (WC-252), and open your chat with
 * them, or start one, at `/comm/<id>`. At most CHAT_MEMBERS_MAX members, you
 * included: once that many are ticked, the rest cannot be. It says why when
 * the members cannot be listed or there is nobody else (rule 7), and a
 * failed start says so and opens nothing (rule 6).
 */
function ContactPicker({ me, partners, problem }: { me: string; partners: ChatPartnerOption[]; problem: string | null }) {
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const menu = useRef<HTMLDetailsElement>(null);

  if (problem !== null) {
    return <p className="error chat-picker" role="alert">The members could not be listed, so no new chat can be started here right now: {problem}. Try reloading the page.</p>;
  }
  if (partners.length === 0) return <p className="note chat-picker" role="status">{NO_PARTNERS}</p>;

  const full = picked.length + 1 >= CHAT_MEMBERS_MAX;
  const pickedNames = partners.filter((p) => picked.includes(p.id)).map((p) => p.name);
  const toggle = (id: string, on: boolean) => {
    setFailure(null);
    setPicked((now) => (on ? (now.includes(id) ? now : [...now, id]) : now.filter((x) => x !== id)));
  };

  function start(e: FormEvent) {
    e.preventDefault();
    if (picked.length === 0) {
      setFailure("No chat was started. Pick a member first.");
      return;
    }
    const problem = startChatProblem(me, picked);
    if (problem) {
      setFailure(notStarted(problem));
      return;
    }
    setFailure(null);
    startTransition(async () => {
      try {
        const result = await startChatWith(picked);
        if (!result.ok) {
          setFailure(notStarted(result.error));
          return;
        }
        setPicked([]);
        if (menu.current) menu.current.open = false;
        router.push(`/comm/${result.id}`);
      } catch {
        setFailure(START_UNREACHABLE);
      }
    });
  }

  return (
    <form className="chat-picker task-chat-start" onSubmit={start}>
      <span id="chat-with-label">Chat with</span>
      <details ref={menu} className="chat-pick">
        <summary aria-describedby="chat-with-label">{pickedNames.length ? namesInWords(pickedNames) : "Pick members…"}</summary>
        <fieldset className="chat-pick-list" aria-labelledby="chat-with-label">
          {partners.map((p) => {
            const on = picked.includes(p.id);
            return (
              <label key={p.id}>
                <input type="checkbox" name="chat-partner" value={p.id} checked={on} disabled={!on && full} onChange={(e) => toggle(p.id, e.target.checked)} />
                {p.name}
              </label>
            );
          })}
          {full && <p className="note" role="status">A chat can have at most {CHAT_MEMBERS_MAX} members, you included.</p>}
        </fieldset>
      </details>
      <button type="submit" disabled={pending}>{pending ? "Opening…" : picked.length > 1 ? "Start group chat" : "Open chat"}</button>
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
 * messages holding the words typed; `range` (the From and To days the chat
 * window picks, WC-245/WC-253) shows only the messages sent between them.
 * `addFrom` (the Sync mode's window, WC-256) adds an "Add someone" button
 * under the heading, offering the members not yet in the chat.
 */
export function Conversation({
  me,
  chat,
  showTopic = true,
  newestOnTop = false,
  searchable = false,
  range = ANY_DATE,
  addFrom,
}: {
  me: string;
  chat: OpenChat;
  showTopic?: boolean;
  newestOnTop?: boolean;
  searchable?: boolean;
  range?: DateRange;
  /** The members "Add someone" may offer, and why they could not be listed (or null). Absent: no adding. */
  addFrom?: { partners: ChatPartnerOption[]; problem: string | null };
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const sending = useRef(false);
  const box = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState("");
  const searching = searchable && isSearching(query);
  const dating = searchable && isDateFiltering(range);
  const backwards = dating && isRangeBackwards(range);
  const ordered = newestOnTop ? newestFirst(chat.messages) : chat.messages;
  const byWords = searching ? searchMessages(ordered, query) : ordered;
  const shownMessages = backwards ? [] : dating ? messagesInRange(byWords, range) : byWords;
  const filtering = searching || dating;
  const usedRange = dating ? range : ANY_DATE;

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
      {addFrom && chat.memberIds && <AddSomeone chatId={chat.id} memberIds={chat.memberIds} partners={addFrom.partners} problem={addFrom.problem} />}
      {newestOnTop && sendForm}
      {searchable && chat.error === null && chat.messages.length > 0 && (
        <div className="chat-search">
          <span className="chat-search-words">
            <label htmlFor={`chat-search-${chat.id}`}>Search this chat</label>
            <input
              id={`chat-search-${chat.id}`}
              type="search"
              value={query}
              placeholder="Words in a message"
              onChange={(e) => setQuery(e.target.value)}
            />
          </span>
          {/* No match says so once, in the messages box below. */}
          {filtering && shownMessages.length > 0 && <p className="note" role="status">{matchCountLine(shownMessages.length, chat.messages.length, searching ? query : "", usedRange)}</p>}
        </div>
      )}
      {newestOnTop && readLine}
      <div ref={box} className={`chat-messages box${newestOnTop ? " newest-on-top" : ""}`} aria-live="polite">
        {chat.error !== null ? (
          <p className="error" role="alert">The messages could not be loaded: {chat.error}. Nothing has been lost; try reloading the page.</p>
        ) : chat.messages.length === 0 ? (
          <p className="note" role="status">{newestOnTop ? NO_MESSAGES_ABOVE : NO_MESSAGES}</p>
        ) : backwards ? (
          <p className="note" role="status">{backwardsRangeLine(range)}</p>
        ) : shownMessages.length === 0 ? (
          <p className="note" role="status">{noMatchLine(searching ? query : "", usedRange)}</p>
        ) : (
          <>
            {/* WC-241: the two sides named once, over their columns, instead of on every message.
                Hidden from screen readers: each message says its own sender to them below. */}
            <div className="chat-heads" aria-hidden="true">
              <b>{chat.otherName}</b>
              <b>You</b>
            </div>
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
                      {/* WC-252: in a group, every message names its sender, on screen and to screen readers. */}
                      {chat.group ? (
                        <b className="chat-sender">{senderName(m.senderId, me, chat.senderNames ?? {})}<span className="sr-only">: </span></b>
                      ) : (
                        <span className="sr-only">{mine ? "You" : chat.otherName}: </span>
                      )}
                      {/* WC-242: the day break above names the day, so the clock time alone; hover for the full date. */}
                      <time className="chat-meta note" dateTime={m.sentAt} title={sentLabel(m.sentAt)}>{clockLabel(m.sentAt)}</time>
                      <span className="chat-body">{m.body}</span>
                    </li>
                  </Fragment>
                );
              })}
            </ol>
          </>
        )}
      </div>
      {!newestOnTop && readLine}
      {!newestOnTop && sendForm}
    </>
  );
}

/**
 * "Add someone" (WC-256, "Let a chat member add one more person to a
 * chat"): opens a picker of the members not yet in the chat; picking one and
 * pressing Add brings them in, and the page reloads so the heading and the
 * column heads name them. A refused or failed add says so and adds nobody
 * (rule 6); a full chat, or one everyone is already in, says why there is
 * nobody to pick (rule 7).
 */
function AddSomeone({ chatId, memberIds, partners, problem }: { chatId: string; memberIds: string[]; partners: ChatPartnerOption[]; problem: string | null }) {
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const candidates = addableMembers(partners, memberIds);
  const full = memberIds.length >= CHAT_MEMBERS_MAX;

  function close() {
    setPicking(false);
    setPicked("");
    setFailure(null);
  }

  function add(e: FormEvent) {
    e.preventDefault();
    if (!picked) {
      setFailure("Nobody was added. Pick a member first.");
      return;
    }
    setFailure(null);
    startTransition(async () => {
      try {
        const result = await addToChat(chatId, picked);
        if (!result.ok) {
          setFailure(notAdded(result.error));
          return;
        }
        close();
        router.refresh();
      } catch {
        setFailure(ADD_UNREACHABLE);
      }
    });
  }

  if (!picking) {
    return (
      <p className="chat-add">
        <button type="button" className="link" onClick={() => setPicking(true)}>Add someone</button>
      </p>
    );
  }
  const why =
    problem !== null
      ? `The members could not be listed, so nobody can be added right now: ${problem}. Try reloading the page.`
      : full
        ? `This chat is full: a chat can have at most ${CHAT_MEMBERS_MAX} members.`
        : candidates.length === 0
          ? EVERYONE_IN_CHAT
          : null;
  return (
    <form className="chat-add" onSubmit={add}>
      {why !== null ? (
        <p className={problem !== null ? "error" : "note"} role={problem !== null ? "alert" : "status"}>{why}</p>
      ) : (
        <>
          <label htmlFor={`chat-add-${chatId}`}>Add to this chat</label>
          <select id={`chat-add-${chatId}`} value={picked} onChange={(e) => { setPicked(e.target.value); setFailure(null); }}>
            <option value="">Pick a member…</option>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button type="submit" disabled={pending}>{pending ? "Adding…" : "Add"}</button>
        </>
      )}
      <button type="button" className="link" onClick={close} disabled={pending}>{why !== null ? "Close" : "Cancel"}</button>
      {failure && <p className="error" role="alert">{failure}</p>}
    </form>
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
