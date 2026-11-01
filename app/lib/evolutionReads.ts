/**
 * The Evolution view's read: every change merged into main, oldest first,
 * with a short-lived signed link to each screenshot and the WaveCenter task
 * each change belongs to. It acts through the signed-in member's own
 * session, so row-level security decides what comes back; the bucket is
 * private, so a signed link is the only way to a picture, and a signed-out
 * visitor never gets one.
 */
import { fullDate } from "../tasks/listView";
import { prUrl, tasksByTicket, ticketId, type EvolutionCard } from "../tasks/evolutionView";
import type { supabaseForRequest } from "./supabase";

type Client = NonNullable<Awaited<ReturnType<typeof supabaseForRequest>>>;

/** The bucket the screenshot taker writes (scripts/lib/evolution.mjs). */
const EVOLUTION_BUCKET = "evolution";

/** How long a link to a screenshot works: one hour. */
const PICTURE_LINK_SECONDS = 60 * 60;

/**
 * The cards, oldest first. `error` means the changes themselves could not be
 * read. `problems` are the smaller failures (the picture links, the task
 * links) said on the page while the cards still show (rule 7).
 */
export async function loadEvolution(supabase: Client): Promise<{ cards: EvolutionCard[]; error: string | null; problems: string[] }> {
  const { data: rows, error } = await supabase
    .from("evolution_entries")
    .select("commit_sha, merged_at, pr_number, title, ticket_url, page, screenshot_path, capture_state, failure_reason")
    .order("merged_at")
    .order("commit_sha");
  if (error) return { cards: [], error: error.message, problems: [] };
  if (!rows?.length) return { cards: [], error: null, problems: [] };

  const problems: string[] = [];
  const paths = rows.filter((r) => r.capture_state === "captured" && r.screenshot_path).map((r) => r.screenshot_path as string);
  const withTickets = rows.some((r) => ticketId(r.ticket_url));
  const [links, tasks] = await Promise.all([
    paths.length
      ? supabase.storage.from(EVOLUTION_BUCKET).createSignedUrls(paths, PICTURE_LINK_SECONDS)
      : { data: [], error: null },
    withTickets
      ? supabase.from("tasks").select("id, agent_ticket_url").not("agent_ticket_url", "is", null)
      : { data: [], error: null },
  ]);
  if (links.error) problems.push(`The screenshots could not be loaded: ${links.error.message}. Try reloading the page.`);
  if (tasks.error) problems.push(`The links to WaveCenter tasks could not be read: ${tasks.error.message}.`);
  const pictures = new Map((links.data ?? []).filter((l) => l.signedUrl).map((l) => [l.path, l.signedUrl]));
  const taskFor = tasksByTicket((tasks.data ?? []).map((t) => ({ id: t.id, agentTicketUrl: t.agent_ticket_url })));

  return {
    cards: rows.map((r) => {
      const ticket = ticketId(r.ticket_url);
      return {
        sha: r.commit_sha,
        title: r.title,
        mergedAt: fullDate(r.merged_at),
        prNumber: r.pr_number,
        prUrl: prUrl(r.pr_number),
        ticketUrl: r.ticket_url,
        taskId: ticket ? (taskFor.get(ticket) ?? null) : null,
        state: r.capture_state,
        page: r.page,
        imageUrl: r.screenshot_path ? (pictures.get(r.screenshot_path) ?? null) : null,
        failureReason: r.failure_reason,
      };
    }),
    error: null,
    problems,
  };
}
