"use client";

/**
 * The task page's Discussion: the same thread as on the list (Discussion.tsx),
 * closed until clicked. Every save is a server action; a confirmed one
 * reloads the page's data so the thread shows it, and a failed one says why
 * under the thread (engineering rule 6).
 *
 * It is live (WC-172): while the page is open it listens for any comment on
 * this task being posted, edited or deleted, by anyone, and reloads the
 * page's data when one is. The server stays the one source of what the thread
 * shows, so a comment appears once, in its place, with its files, and your
 * own post never shows twice. When the live connection cannot start, is
 * slow to start, or drops, one plain line says so (rule 7).
 *
 * Every time the listen becomes live (the first time and after any rejoin) the
 * thread reloads once, so a comment that landed while it was not yet
 * listening is never missed. The connection depends only on the address and
 * key, not on the props object, so a reload does not tear it down and rejoin.
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { TaskComment } from "../../../core/comments.ts";
import type { SaveResult } from "../actions";
import Discussion from "../Discussion";
import type { ListFile } from "../TaskList";
import { UNREACHABLE } from "../upload";
import { listenToTable, type LiveSettings, type LiveState } from "../../lib/realtimeClient";

/** Shown while live updates are not arriving. */
export const DISCUSSION_PAUSED = "Live updates paused, reload to see new comments.";

export default function TaskDiscussion({
  taskId,
  taskTitle,
  comments,
  files,
  userId,
  canAttach,
  live,
}: {
  taskId: string;
  taskTitle: string;
  comments: TaskComment[];
  /** The files attached to its comments. */
  files: ListFile[];
  userId: string;
  /** Files go only on comments on the member's own tasks. */
  canAttach: boolean;
  /** Where to listen for live updates; null when this deployment has no database settings. */
  live: LiveSettings;
}) {
  const router = useRouter();
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [liveState, setLiveState] = useState<LiveState>("connecting");
  // The comments on screen, for telling whether a delete (which names only an id) is one of ours.
  const shownIds = useRef(new Set<string>());
  shownIds.current = new Set(comments.map((c) => c.id));

  // The connection follows these two strings, not the `live` object, which is
  // new on every server render: depending on it would rejoin on every reload.
  const liveUrl = live?.url ?? null;
  const liveKey = live?.anonKey ?? null;
  useEffect(() => {
    const settings: LiveSettings = liveUrl && liveKey ? { url: liveUrl, anonKey: liveKey } : null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Several changes close together reload once.
    const reload = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 150);
    };
    const stop = listenToTable(settings, {
      table: "task_comments",
      filter: `task_id=eq.${taskId}`,
      onChange: (change) => {
        if (change.eventType !== "DELETE") return reload();
        const id = (change.old as { id?: unknown }).id;
        if (typeof id === "string" && shownIds.current.has(id)) reload();
      },
      onState: (state) => {
        setLiveState(state);
        // Listening now, first time or again: catch up on anything said
        // before the listen was in place.
        if (state === "live") reload();
      },
    });
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [liveUrl, liveKey, taskId, router]);
  const filesByComment = new Map<string, ListFile[]>();
  for (const f of files) if (f.commentId) filesByComment.set(f.commentId, [...(filesByComment.get(f.commentId) ?? []), f]);

  /** Run one save; resolves true only on a confirmed save. */
  function run(action: () => Promise<SaveResult>): Promise<boolean> {
    return new Promise((resolve) => {
      startTransition(async () => {
        let result: SaveResult;
        try {
          result = await action();
        } catch {
          result = { ok: false, error: UNREACHABLE };
        }
        setFailure(result.ok ? null : result.error);
        if (result.ok) router.refresh();
        resolve(result.ok);
      });
    });
  }

  return (
    <details className="task-discussion box">
      <summary>
        Discussion{comments.length > 0 && ` (${comments.length} comment${comments.length === 1 ? "" : "s"})`}
      </summary>
      {liveState === "paused" && <p className="note live-paused" role="status">{DISCUSSION_PAUSED}</p>}
      <Discussion taskId={taskId} taskTitle={taskTitle} comments={comments} files={filesByComment} userId={userId} canAttach={canAttach} pending={pending} run={run} />
      {failure && <p className="error" role="alert">{failure}</p>}
    </details>
  );
}
