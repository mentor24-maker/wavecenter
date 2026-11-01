/**
 * The pure rules behind the Evolution scroller on Home: whether an old
 * `/tasks?view=evolution` link asks for it, which changes are cards, the
 * words and link each card shows, and how the full-size view steps.
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
  /** Dane's own words that asked for the change, or, with none on record, a short statement of what changed. */
  words: string;
  /** Whether `words` are Dane's own. */
  fromDane: boolean;
  /** Where the change was discussed: a WaveCenter task (/tasks/<id>), its ClickUp ticket, or its PR. */
  threadUrl: string | null;
  /** The merge date in Mountain time, e.g. "Oct 31, 2026, 2:15 PM MT". */
  mergedAt: string;
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

/**
 * Only changes that altered a screen are cards (Dane, 2026-10-31: "Only
 * show slides that have a visible change in the UI"): a change that touched
 * no screen, or whose screen could not be rebuilt, is left out.
 */
export function showsOnScroller(state: EvolutionCard["state"]): boolean {
  return state === "captured";
}

/**
 * What a change was, in a few words, for a change with none of Dane's words
 * on record (Dane, 2026-11-01: "a concise statement to say what the change
 * was"). A ticket's name reads "<what breaks and who feels it>: <the fix>",
 * so this is the fix, with a capital letter; a name without that shape is
 * kept whole.
 */
export function changeStatement(title: string): string {
  const t = String(title ?? "").trim();
  const at = t.indexOf(": ");
  const fix = at > 0 ? t.slice(at + 2).trim() : t;
  return fix ? fix[0].toUpperCase() + fix.slice(1) : t;
}

/**
 * The words and the thread link a card shows: Dane's words and where he
 * said them when they are on record, else the short statement and the
 * change's ticket (or its PR).
 */
export function cardWords(row: { title: string; prompt: string | null; thread_url: string | null; ticket_url: string | null; pr_number: number | null }): Pick<EvolutionCard, "words" | "fromDane" | "threadUrl"> {
  const prompt = row.prompt?.trim();
  if (prompt) return { words: prompt, fromDane: true, threadUrl: row.thread_url ?? row.ticket_url ?? prUrl(row.pr_number) };
  return { words: changeStatement(row.title), fromDane: false, threadUrl: row.ticket_url ?? prUrl(row.pr_number) };
}

/** Why the scroller is empty when changes are recorded but none altered a screen (rule 7). */
export function emptyScrollerNote(recorded: number): string {
  return `None of the ${recorded} recorded change${recorded === 1 ? "" : "s"} altered a screen that could be photographed, so there is nothing to show yet.`;
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
