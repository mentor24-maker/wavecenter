/**
 * The most recently completed tasks (WC-265): the list in Home's "Recently
 * completed tasks" box, and the website manager's module of the same name
 * that shows it on a page. Both read it through one shared function
 * (app/lib/taskReads.ts readRecentlyCompleted), so they can never disagree:
 * tasks with status `done`, newest `completed_at` first, at most
 * RECENTLY_COMPLETED of them, each with the day it was done in Mountain time.
 *
 * Who sees it on a website page follows the Leaderboard module's rule
 * (WC-237, Dane's choice there): website pages are open to anyone, so a
 * visitor who is not signed in sees no task titles, only a note to sign in;
 * a sign-in check that failed says so instead of asking them to sign in.
 */
import { leaderboardTopAccess, type LeaderboardVisitor } from './leaderboard.ts';

/** How many of the most recently completed tasks Home and the module show. */
export const RECENTLY_COMPLETED = 5;

/** One completed task, as the list shows it. */
export interface CompletedTask {
  id: string;
  title: string;
  /** When it was marked done, as the database stores it; null if never stamped. */
  completedAt: string | null;
}

/** "Done" dates are shown in Mountain time, Dane's own: "Nov 27, 2026". */
const DAY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric', year: 'numeric' });

/** The day a task was done, "Mon D, YYYY" in Mountain time, or "" when there is no usable date. */
export function completedDay(completedAt: string | null | undefined): string {
  if (!completedAt) return '';
  const when = new Date(completedAt);
  return Number.isNaN(when.getTime()) ? '' : DAY.format(when);
}

/** A database row as a CompletedTask; anything unreadable becomes null and is left out. */
export function completedTaskFromRow(row: unknown): CompletedTask | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id === '') return null;
  return {
    id: r.id,
    title: typeof r.title === 'string' ? r.title : '',
    completedAt: typeof r.completed_at === 'string' ? r.completed_at : null,
  };
}

/**
 * What the Recently completed tasks module on a website page has to draw,
 * read on the server when the page is drawn:
 * - `signed-out`: the visitor is not signed in, so it shows only a note to
 *   sign in, no task titles;
 * - `rows`: the most recent completed tasks, at most RECENTLY_COMPLETED, maybe none;
 * - `failed`: they could not be read, in plain words.
 */
export type RecentlyCompleted =
  | { kind: 'signed-out' }
  | { kind: 'rows'; rows: CompletedTask[] }
  | { kind: 'failed'; problem: string };

/**
 * Whether the module may read the tasks for this visitor, and if not, why,
 * decided before any read. The same rule as the Leaderboard module's
 * (leaderboardTopAccess), so the two modules never treat a visitor
 * differently: no database settings, then a failed sign-in check (never
 * told to sign in), then signed out (nothing read), then `read`.
 */
export function recentlyCompletedAccess(
  visitor: LeaderboardVisitor,
  hasDatabase: boolean,
): 'check-failed' | 'signed-out' | 'no-database' | 'read' {
  return leaderboardTopAccess(visitor, hasDatabase);
}
