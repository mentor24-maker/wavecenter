"use client";

/**
 * The header's Chat link, with the number of chats that have a message
 * waiting (WC-176: "Members cannot tell when a chat message is waiting: show
 * unread count"). Hidden at 0, "9+" above 9 (core/chat.ts `unreadBadge`).
 *
 * Live: on every WaveCenter page it listens, through the one live helper
 * (app/lib/realtimeClient.ts), for chat messages other members send, and
 * counts again when one arrives. Row-level security means it only hears
 * about chats this member is in. It also counts again the moment an open
 * chat is marked read (`CHAT_UNREAD_EVENT`), and every time the listen becomes
 * live, so nothing sent while it was connecting is missed.
 *
 * The count is asked of the server (`unreadChatCount`), which reads it
 * through the member's own session. A count that could not be read shows
 * "?" with the reason, never 0 (rule 7). While live updates are paused the
 * badge keeps its last number; the chat window says when it is paused.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { unreadBadge } from "../core/chat.ts";
import { unreadChatCount } from "./chat/actions";
import { CHAT_UNREAD_EVENT } from "./chat/chatView";
import { listenToTable, type LiveSettings } from "./lib/realtimeClient";

type Count = { state: "loading" } | { state: "ok"; chats: number } | { state: "failed"; error: string };

export default function ChatLink({ liveUrl, liveKey }: { liveUrl: string | null; liveKey: string | null }) {
  const [count, setCount] = useState<Count>({ state: "loading" });
  const [me, setMe] = useState<string | null>(null);
  const asking = useRef(0);

  useEffect(() => {
    let gone = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = () => {
      const mine = ++asking.current;
      unreadChatCount()
        .then((r) => {
          // Only the newest answer counts: an older one arriving late is stale.
          if (gone || mine !== asking.current) return;
          if (r.ok) {
            setCount({ state: "ok", chats: r.chats });
            setMe(r.memberId);
          } else {
            setCount({ state: "failed", error: r.error });
          }
        })
        .catch(() => {
          if (!gone && mine === asking.current) setCount({ state: "failed", error: "Could not reach WaveCenter to count unread chats." });
        });
    };
    // Several changes close together count once.
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(ask, 300);
    };
    ask();
    window.addEventListener(CHAT_UNREAD_EVENT, soon);
    return () => {
      gone = true;
      clearTimeout(timer);
      window.removeEventListener(CHAT_UNREAD_EVENT, soon);
    };
  }, []);

  // Listen once the member is known: the filter needs their id. The listen
  // follows these strings only, so a page reload does not rejoin it.
  useEffect(() => {
    if (!me) return;
    const settings: LiveSettings = liveUrl && liveKey ? { url: liveUrl, anonKey: liveKey } : null;
    if (!settings) return;
    const soon = () => window.dispatchEvent(new Event(CHAT_UNREAD_EVENT));
    const stop = listenToTable(settings, {
      table: "chat_messages",
      // Messages from anyone else, in any chat this member is in.
      filter: `sender_id=neq.${me}`,
      onChange: (change) => {
        if (change.eventType === "INSERT") soon();
      },
      onState: (state) => {
        if (state === "live") soon();
      },
    });
    return stop;
  }, [me, liveUrl, liveKey]);

  const badge = count.state === "ok" ? unreadBadge(count.chats) : null;
  const label =
    count.state === "failed"
      ? `Chat (unread chats could not be counted: ${count.error})`
      : count.state === "ok" && badge
        ? `Chat, ${count.chats} ${count.chats === 1 ? "chat" : "chats"} with unread messages`
        : undefined;
  return (
    <Link href="/chat" className="quiet chat-link" aria-label={label} title={count.state === "failed" ? count.error : undefined}>
      Chat
      {badge && <span className="unread-badge" aria-hidden="true">{badge}</span>}
      {count.state === "failed" && <span className="unread-badge unknown" aria-hidden="true">?</span>}
    </Link>
  );
}
