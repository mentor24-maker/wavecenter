"use server";

/**
 * The header Alerts pod's task count (WC-182): how many open tasks (`todo`
 * or `doing`, core/alerts.ts) the signed-in member owns. Read on the server
 * through the member's own session, never the service key (rule 3). A failed
 * read says so in plain words, never 0 (rule 7).
 */
import { OPEN_TASK_STATUSES, openTaskCount } from "../../core/alerts.ts";
import { currentUser, supabaseForRequest } from "../lib/supabase";

export type OpenTaskCountResult = { ok: true; tasks: number } | { ok: false; error: string };

export async function myOpenTaskCount(): Promise<OpenTaskCountResult> {
  try {
    const supabase = await supabaseForRequest();
    if (!supabase) return { ok: false, error: "This copy of WaveCenter has no database settings, so open tasks cannot be counted." };
    const { user, checkFailed } = await currentUser(supabase);
    if (!user) {
      return {
        ok: false,
        error: checkFailed
          ? "WaveCenter could not check that you are signed in, so open tasks cannot be counted. Try again in a minute."
          : "You are signed out, so open tasks cannot be counted. Reload the page and log in again.",
      };
    }
    const { data, error } = await supabase
      .from("tasks")
      .select("owner_id, status")
      .eq("owner_id", user.id)
      .in("status", [...OPEN_TASK_STATUSES]);
    if (error) {
      console.error("alerts: could not count open tasks:", error.message);
      return { ok: false, error: "Your open tasks could not be counted." };
    }
    const rows = (data ?? []).map((r: { owner_id: string; status: string }) => ({ ownerId: r.owner_id, status: r.status as "todo" | "doing" }));
    return { ok: true, tasks: openTaskCount(rows, user.id) };
  } catch (err) {
    console.error("alerts: could not count open tasks:", err);
    return { ok: false, error: "Your open tasks could not be counted." };
  }
}
