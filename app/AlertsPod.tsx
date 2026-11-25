"use client";

/**
 * The header's Alerts pod (WC-182, "Add Alerts section to header"): the
 * member's next steps, between the account line and the main menu. Two
 * alerts, by Dane's answer on the ticket: chats with a new message (linking
 * to /chat) and the member's open tasks, `todo` or `doing` (linking to
 * /tasks). The rules are in core/alerts.ts.
 *
 * The message count is the same one the Chat link shows (`unreadChatCount`),
 * and it updates live the same way: ChatLink's one live listen sends
 * `CHAT_UNREAD_EVENT` when a message arrives, and the pod counts again then.
 * There is no second listen. Both counts are asked again on every page change.
 *
 * Nothing waiting, it says "No alerts", never an empty box; a count that
 * could not be read shows "?" with the reason, never 0 (rule 7).
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { alertText, noAlerts, type AlertCount } from "../core/alerts.ts";
import { myOpenTaskCount } from "./alerts/actions";
import { unreadChatCount } from "./comm/actions";
import { CHAT_UNREAD_EVENT } from "./comm/chatView";

const UNREACHABLE = "Could not reach WaveCenter to count your alerts.";

export default function AlertsPod() {
  const pathname = usePathname();
  const [messages, setMessages] = useState<AlertCount | null>(null);
  const [tasks, setTasks] = useState<AlertCount | null>(null);
  const askingMessages = useRef(0);
  const askingTasks = useRef(0);

  useEffect(() => {
    let gone = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const askMessages = () => {
      const mine = ++askingMessages.current;
      unreadChatCount()
        .then((r) => {
          // Only the newest answer counts: an older one arriving late is stale.
          if (gone || mine !== askingMessages.current) return;
          setMessages(r.ok ? { ok: true, count: r.chats } : { ok: false, error: r.error });
        })
        .catch(() => {
          if (!gone && mine === askingMessages.current) setMessages({ ok: false, error: UNREACHABLE });
        });
    };
    const askTasks = () => {
      const mine = ++askingTasks.current;
      myOpenTaskCount()
        .then((r) => {
          if (gone || mine !== askingTasks.current) return;
          setTasks(r.ok ? { ok: true, count: r.tasks } : { ok: false, error: r.error });
        })
        .catch(() => {
          if (!gone && mine === askingTasks.current) setTasks({ ok: false, error: UNREACHABLE });
        });
    };
    // Several chat changes close together count once.
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(askMessages, 300);
    };
    askMessages();
    askTasks();
    window.addEventListener(CHAT_UNREAD_EVENT, soon);
    return () => {
      gone = true;
      clearTimeout(timer);
      window.removeEventListener(CHAT_UNREAD_EVENT, soon);
    };
  }, [pathname]);

  if (!messages || !tasks) {
    return (
      <div className="alerts" role="status" aria-label="Alerts">
        <span className="alerts-quiet">Counting alerts…</span>
      </div>
    );
  }
  if (noAlerts(messages, tasks)) {
    return (
      <div className="alerts" role="status" aria-label="Alerts">
        <span className="alerts-quiet">No alerts</span>
      </div>
    );
  }
  return (
    <nav className="alerts" aria-label="Alerts">
      <Link href="/comm" className="quiet" title={messages.ok ? undefined : messages.error}>
        {alertText("messages", messages)}
      </Link>
      <span className="sep" aria-hidden="true">|</span>
      <Link href="/tasks" className="quiet" title={tasks.ok ? undefined : tasks.error}>
        {alertText("tasks", tasks)}
      </Link>
    </nav>
  );
}
