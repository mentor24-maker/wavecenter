"use client";

/**
 * The task page's Discussion: the same thread as on the list (Discussion.tsx),
 * closed until clicked. Every save is a server action; a confirmed one
 * reloads the page's data so the thread shows it, and a failed one says why
 * under the thread (engineering rule 6).
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { TaskComment } from "../../../core/comments.ts";
import type { SaveResult } from "../actions";
import Discussion from "../Discussion";
import type { ListFile } from "../TaskList";
import { UNREACHABLE } from "../upload";

export default function TaskDiscussion({
  taskId,
  taskTitle,
  comments,
  files,
  userId,
}: {
  taskId: string;
  taskTitle: string;
  comments: TaskComment[];
  /** The files attached to its comments. */
  files: ListFile[];
  userId: string;
}) {
  const router = useRouter();
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
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
    <details className="task-discussion">
      <summary>
        Discussion{comments.length > 0 && ` (${comments.length} comment${comments.length === 1 ? "" : "s"})`}
      </summary>
      <Discussion taskId={taskId} taskTitle={taskTitle} comments={comments} files={filesByComment} userId={userId} pending={pending} run={run} />
      {failure && <p className="error" role="alert">{failure}</p>}
    </details>
  );
}
