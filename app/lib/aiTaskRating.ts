/**
 * The Admin page's read of the AI rating lane's newest pass report
 * (`ai_rating_passes`). The lane itself runs on the Mac Mini through Claude
 * Code under Dane's plan (scripts/rate_tasks.mjs); the website never calls
 * the AI and holds no AI key (Dane, 2026-11-04: "go with the Mini").
 *
 * Read through the member's own session: every signed-in member may read the
 * reports. A failed read throws, so the page says why instead of showing an
 * empty panel (engineering rule 7).
 */
import "server-only";
import type { supabaseForRequest } from "./supabase";

type Client = NonNullable<Awaited<ReturnType<typeof supabaseForRequest>>>;

export interface RatingPassReport {
  startedAt: string;
  finishedAt: string;
  signedInWith: string | null;
  rated: number;
  failed: { taskId: string; title: string; reason: string }[];
  waiting: number;
  upToDate: number;
  error: string | null;
}

/** The newest pass report, or null when the lane has never run. */
export async function newestRatingPass(supabase: Client): Promise<RatingPassReport | null> {
  const { data, error } = await supabase
    .from("ai_rating_passes")
    .select("started_at, finished_at, signed_in_with, rated, failed, waiting, up_to_date, error")
    .order("finished_at", { ascending: false })
    .order("seq", { ascending: false })
    .limit(1);
  if (error) throw new Error(`The database refused to read the AI rating lane's reports: ${error.message}`);
  const r = data?.[0];
  if (!r) return null;
  return {
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    signedInWith: r.signed_in_with,
    rated: r.rated,
    failed: (Array.isArray(r.failed) ? r.failed : []).map((f: any) => ({ taskId: String(f.task_id), title: String(f.title), reason: String(f.reason) })),
    waiting: r.waiting,
    upToDate: r.up_to_date,
    error: r.error,
  };
}
