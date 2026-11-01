/**
 * The Evolution view's read: every change merged into main that altered a
 * screen, oldest first, with Dane's words behind it and a short-lived signed
 * link to its screenshot. It acts through the signed-in member's own
 * session, so row-level security decides what comes back; the bucket is
 * private, so a signed link is the only way to a picture, and a signed-out
 * visitor never gets one.
 */
import { fullDate } from "../tasks/listView";
import { cardWords, showsOnScroller, type EvolutionCard } from "../tasks/evolutionView";
import type { supabaseForRequest } from "./supabase";

type Client = NonNullable<Awaited<ReturnType<typeof supabaseForRequest>>>;

/** The bucket the screenshot taker writes (scripts/lib/evolution.mjs). */
const EVOLUTION_BUCKET = "evolution";

/** How long a link to a screenshot works: one hour. */
const PICTURE_LINK_SECONDS = 60 * 60;

/**
 * The cards, oldest first, and how many changes are recorded in all
 * (`recorded`), so an empty scroller can say why it is empty. `error` means
 * the changes and Dane's words could not be read. `problems` are the
 * smaller failures (the picture links) said on the page while the cards
 * still show (rule 7).
 */
export async function loadEvolution(supabase: Client): Promise<{ cards: EvolutionCard[]; recorded: number; error: string | null; problems: string[] }> {
  const { data: rows, error } = await supabase
    .from("evolution_entries")
    .select("commit_sha, merged_at, pr_number, title, ticket_url, page, screenshot_path, capture_state, failure_reason, prompt, thread_url")
    .order("merged_at")
    .order("commit_sha");
  if (error) return { cards: [], recorded: 0, error: error.message, problems: [] };
  if (!rows?.length) return { cards: [], recorded: 0, error: null, problems: [] };

  const shown = rows.filter((r) => showsOnScroller(r.capture_state));
  const problems: string[] = [];
  const paths = shown.filter((r) => r.screenshot_path).map((r) => r.screenshot_path as string);
  const links = paths.length
    ? await supabase.storage.from(EVOLUTION_BUCKET).createSignedUrls(paths, PICTURE_LINK_SECONDS)
    : { data: [], error: null };
  if (links.error) problems.push(`The screenshots could not be loaded: ${links.error.message}. Try reloading the page.`);
  const pictures = new Map((links.data ?? []).filter((l) => l.signedUrl).map((l) => [l.path, l.signedUrl]));

  return {
    cards: shown.map((r) => ({
      sha: r.commit_sha,
      ...cardWords(r),
      mergedAt: fullDate(r.merged_at),
      state: r.capture_state,
      page: r.page,
      imageUrl: r.screenshot_path ? (pictures.get(r.screenshot_path) ?? null) : null,
      failureReason: r.failure_reason,
    })),
    recorded: rows.length,
    error: null,
    problems,
  };
}
