/**
 * Every Evolution card has a WaveCenter task behind it (Dane, 2026-11-01: "I
 * thought all cards had to have a task associated with it"). The pure parts
 * of scripts/evolution_backfill_tasks.mjs, tested in evolutionTasks.test.mjs:
 * which cards need what, and the task a card is given.
 *
 * A card with no task_id is one of two kinds:
 *   - it came from a WaveCenter task (its thread_url is /tasks/<id>) and that
 *     task still exists: it is linked to that task, and nothing is made;
 *   - anything else (a chat request, a founding commit, a task since
 *     deleted): it is given a new task, done, 0 points, owned by Dane.
 */

import { mountain } from './evolution.mjs';

const TASK_THREAD = /^\/tasks\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

export const REPO_URL = 'https://github.com/mentor24-maker/wavecenter';

/** The WaveCenter task a card's thread link names, or null. */
export function taskIdFromThread(threadUrl) {
  const m = TASK_THREAD.exec(String(threadUrl ?? '').trim());
  return m ? m[1].toLowerCase() : null;
}

/**
 * What to do for every card that has no task yet, oldest first.
 * `existingTaskIds` is every task id in the table.
 * Returns { link: [{ card, taskId }], create: [card], already: number }.
 */
export function backfillPlan(cards, existingTaskIds) {
  const exists = new Set([...existingTaskIds].map((id) => String(id).toLowerCase()));
  const link = [];
  const create = [];
  let already = 0;
  const oldestFirst = [...cards].sort((a, b) => Date.parse(a.merged_at) - Date.parse(b.merged_at));
  for (const card of oldestFirst) {
    if (card.task_id) { already += 1; continue; }
    const taskId = taskIdFromThread(card.thread_url);
    if (taskId && exists.has(taskId)) link.push({ card, taskId });
    else create.push(card);
  }
  return { link, create, already };
}

/**
 * The task a card is given: its title, and notes holding Dane's words when
 * the card has them, the pull request and ticket, and one line saying the
 * task was made afterwards. `today` is a YYYY-MM-DD date in Mountain time.
 */
export function taskFromCard(card, { today }) {
  const parts = [];
  const words = String(card.prompt ?? '').trim();
  if (words) parts.push(words);
  const where = [];
  if (card.pr_number) where.push(`Pull request #${card.pr_number}: ${REPO_URL}/pull/${card.pr_number}`);
  if (card.ticket_url) where.push(`Ticket: ${card.ticket_url}`);
  if (where.length) parts.push(where.join('\n'));
  parts.push(`This task was created afterwards, on ${today}, so this change's Evolution card has a task. The change itself was merged when this task says it was finished.`);
  return { title: card.title, notes: parts.join('\n\n'), at: card.merged_at };
}

/** One line per card for --dry-run and the run log. */
export function planLine(card, action) {
  const pr = card.pr_number ? `#${card.pr_number}` : 'no PR';
  return `${action}  ${mountain(card.merged_at).slice(0, 10)}  ${pr.padEnd(6)}  ${card.title}`;
}

/** The run's last line. */
export function summaryLine({ linked, created, already }, { dryRun = false } = {}) {
  if (linked === 0 && created === 0 && already === 0) return 'Nothing to do: there are no Evolution cards yet.';
  if (linked === 0 && created === 0) return `Nothing to do: all ${already} Evolution cards already have a task.`;
  const verb = dryRun ? 'Would link' : 'Linked';
  const made = dryRun ? 'would create' : 'created';
  return `${verb} ${linked} card(s) to the task they came from, ${made} ${created} task(s); ${already} card(s) already had one.${dryRun ? ' Dry run: nothing was written.' : ''}`;
}
