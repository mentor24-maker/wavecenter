/**
 * The header's Alerts pod (WC-182, "Add Alerts section to header"): the
 * member's next steps at a glance. Two alerts only, by Dane's answer on the
 * ticket (2026-11-23, "b"): chats with a message waiting, and the member's
 * open tasks, meaning the tasks they own that are `todo` or `doing`.
 * A `proposed` task waits on an admin, not on its owner, and a `done` one
 * needs nothing, so neither counts.
 *
 * Plain TypeScript: no framework (rule 10).
 */
import type { Task, TaskStatus } from './tasks.ts';

/** The statuses that mean a task is waiting on its owner. */
export const OPEN_TASK_STATUSES: readonly TaskStatus[] = ['todo', 'doing'];

/** Whether `task` counts as one of `memberId`'s open tasks. */
export function isOpenTaskFor(task: Pick<Task, 'ownerId' | 'status'>, memberId: string): boolean {
  return !!memberId && task.ownerId === memberId && OPEN_TASK_STATUSES.includes(task.status);
}

/** How many of `tasks` are `memberId`'s open tasks. */
export function openTaskCount(tasks: readonly Pick<Task, 'ownerId' | 'status'>[], memberId: string): number {
  return tasks.filter((t) => isOpenTaskFor(t, memberId)).length;
}

/** One alert's count: a number, or the reason it could not be read (never 0 for a failure, rule 7). */
export type AlertCount = { ok: true; count: number } | { ok: false; error: string };

/**
 * The words for one alert: "1 chat with new messages", "3 open tasks",
 * "? open tasks" when unread. The messages count is chats with something
 * unread (`unreadChatCount`), not messages, so the words say chats.
 */
export function alertText(kind: 'messages' | 'tasks', count: AlertCount): string {
  const [one, many] = kind === 'messages' ? ['chat with new messages', 'chats with new messages'] : ['open task', 'open tasks'];
  if (!count.ok) return `? ${many}`;
  return `${count.count} ${count.count === 1 ? one : many}`;
}

/**
 * Whether the pod has nothing at all to show: both counts read, and both 0.
 * A count that could not be read is never "nothing", so the pod shows it.
 */
export function noAlerts(messages: AlertCount, tasks: AlertCount): boolean {
  return messages.ok && tasks.ok && messages.count < 1 && tasks.count < 1;
}
