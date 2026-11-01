/**
 * The pure rules behind the Evolution scroller on Home: whether an old
 * `/tasks?view=evolution` link asks for it, how a change's merge date and
 * links read, which WaveCenter task a change belongs to, and how the
 * full-size view steps.
 * Merge dates use listView's fullDate, so they read like the task list's.
 * No database, no React; tested in evolutionView.test.ts.
 */
export type TasksView = "list" | "evolution";

/** `/tasks?view=evolution`, an old link to the Evolution view, now sent to Home; anything else is the list. */
export function viewFrom(param: string | string[] | undefined): TasksView {
  const value = Array.isArray(param) ? param[0] : param;
  return value === "evolution" ? "evolution" : "list";
}

/** One change merged into main, as a card shows it. */
export type EvolutionCard = {
  sha: string;
  title: string;
  /** The merge date in Mountain time, e.g. "Oct 31, 2026, 2:15 PM MT". */
  mergedAt: string;
  prNumber: number | null;
  prUrl: string | null;
  ticketUrl: string | null;
  /** The WaveCenter task whose agent ticket is this change's ticket, if any. */
  taskId: string | null;
  state: "captured" | "no screen" | "failed";
  /** The page the screenshot shows, e.g. "/tasks". */
  page: string | null;
  /** A short-lived signed link to the screenshot; null when there is none or it could not be made. */
  imageUrl: string | null;
  failureReason: string | null;
};

const REPOSITORY = "https://github.com/mentor24-maker/wavecenter";

export function prUrl(prNumber: number | null): string | null {
  return prNumber && prNumber > 0 ? `${REPOSITORY}/pull/${prNumber}` : null;
}

/** The ticket id in a ClickUp link ("https://app.clickup.com/t/86bcvtyhn" → "86bcvtyhn"), or null. */
export function ticketId(url: string | null | undefined): string | null {
  const m = String(url ?? "").match(/app\.clickup\.com\/t\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

/**
 * Each ticket id mapped to the task that carries it, from the tasks'
 * `agent_ticket_url`. When two tasks carry the same ticket, the first wins.
 */
export function tasksByTicket(tasks: { id: string; agentTicketUrl: string | null }[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const t of tasks) {
    const id = ticketId(t.agentTicketUrl);
    if (id && !map.has(id)) map.set(id, t.id);
  }
  return map;
}

/** The index the full-size view moves to, or null at either end. */
export function step(index: number, by: -1 | 1, count: number): number | null {
  const next = index + by;
  return next >= 0 && next < count ? next : null;
}

/**
 * Which way an arrow key steps the full-size view, or null for any other key.
 * Heard on the whole document while the view is open, not only on the
 * dialog: once Previous or Next disables at an end, the browser drops focus
 * to the page body, and a listener on the dialog would stop hearing keys.
 */
export function arrowStep(key: string): -1 | 1 | null {
  if (key === "ArrowLeft") return -1;
  if (key === "ArrowRight") return 1;
  return null;
}

/** What a card says instead of a picture. */
export function cardNote(card: Pick<EvolutionCard, "state" | "imageUrl" | "failureReason" | "page">): string | null {
  if (card.state === "no screen") return "This change did not alter any screen.";
  if (card.state === "failed") return `The screen could not be rebuilt for this change: ${(card.failureReason ?? "no reason was recorded").trim().replace(/\.+$/, "")}.`;
  if (!card.imageUrl) return `The screenshot of ${card.page ?? "this screen"} could not be loaded. Try reloading the page.`;
  return null;
}
