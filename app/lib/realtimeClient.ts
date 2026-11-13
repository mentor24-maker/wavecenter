"use client";

/**
 * Live updates in the browser: the one helper that listens to a table through
 * Supabase Realtime (WC-172). The task Discussion uses it first; the member
 * chat window reuses it. Make no second live-connection helper.
 *
 * Realtime pushes a database change to every browser listening, and it checks
 * row-level security for each listener: a browser hears only about rows its
 * signed-in member may read. It is part of open-source Supabase, so it works
 * on any host (engineering rule 11), and the browser connects to Supabase
 * directly, so no long-running server function is needed.
 *
 * What reaches the browser: the project address and the **anon key**, the
 * public key that is safe in a browser only because row-level security
 * decides what it can read. The service key never does (engineering rule 3).
 * The two settings arrive as props from a server page, read per request
 * (`supabaseSettings()`), not baked in at build (engineering rule 4). The
 * member is known from their own session cookie, the same one the server
 * reads.
 */
import { createBrowserClient } from "@supabase/ssr";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

/** What a server page hands a client component so it can listen. Null when this deployment has no database settings. */
export type LiveSettings = { url: string; anonKey: string } | null;

/**
 * Whether updates are arriving: still connecting, live, or paused. A screen
 * that shows "paused" says so in one plain line, so a stale screen never
 * looks current (rule 7).
 */
export type LiveState = "connecting" | "live" | "paused";

/** One change to a row, as Realtime sends it. A delete carries only the row's id. */
export type LiveChange = RealtimePostgresChangesPayload<Record<string, unknown>>;

/**
 * Listen to inserts, updates and deletes on one table of the `public` schema.
 *
 * `filter` narrows inserts and updates, in Realtime's own form
 * (`task_id=eq.<id>`). Realtime cannot filter deletes, so every delete the
 * member may know of arrives, with only its id: the caller checks the id
 * against what it is showing.
 *
 * Returns a function that stops listening. Call it when the screen goes away.
 */
export function listenToTable(
  settings: LiveSettings,
  { table, filter, onChange, onState }: {
    table: string;
    filter?: string;
    onChange: (change: LiveChange) => void;
    onState: (state: LiveState) => void;
  },
): () => void {
  if (!settings) {
    onState("paused");
    return () => {};
  }
  let stopped = false;
  let stop = () => {};
  onState("connecting");
  try {
    // One browser client per page (createBrowserClient keeps a single one). It
    // reads the member's session from the cookie and hands its token to
    // Realtime, renewing it as it goes.
    const supabase = createBrowserClient(settings.url, settings.anonKey);
    const name = `${table}:${filter ?? "all"}:${Math.random().toString(36).slice(2)}`;
    const channel = supabase
      .channel(name)
      // One listen per filter: two with the same table and filter (one for
      // inserts, one for updates) collide in Realtime and one goes deaf. A
      // delete carries only the row's id, so the filter never matches it,
      // and the second, unfiltered listen hears deletes.
      .on("postgres_changes", { event: "*", schema: "public", table, ...(filter ? { filter } : {}) }, onChange)
      .on("postgres_changes", { event: "DELETE", schema: "public", table }, onChange)
      // Realtime confirms, or refuses, the database side of the listen in a
      // separate "system" message, after the channel itself has joined. A
      // refusal (a bad filter, a member it cannot see) leaves the channel
      // joined but deaf, so it must show as paused, never as live.
      .on("system", {}, (message: { extension?: string; status?: string }) => {
        if (stopped || message.extension !== "postgres_changes") return;
        onState(message.status === "ok" ? "live" : "paused");
      });
    stop = () => void supabase.removeChannel(channel);
    // Sign the connection in as the member before joining, so row-level
    // security sees them and not a signed-out visitor.
    void supabase.realtime
      .setAuth()
      .catch(() => undefined)
      .then(() => {
        if (stopped) return;
        channel.subscribe((status) => {
          if (stopped) return;
          // Joined: live once the "system" message above says the database side is listening.
          if (status !== "SUBSCRIBED") onState("paused"); // CHANNEL_ERROR, TIMED_OUT or CLOSED
        });
      });
  } catch {
    onState("paused");
  }
  return () => {
    stopped = true;
    stop();
  };
}
