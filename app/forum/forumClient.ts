/**
 * Small pieces the Forum's screens share in the browser: the date format the
 * tables use (Mountain time), and a wrapper that turns a server action that
 * could not be reached into a plain-words refusal, so a save never fails
 * silently (engineering rule 6).
 */
import type { ForumSaveResult } from "./actions";

export const UNREACHABLE = "Could not reach WaveCenter, so nothing was saved. Check your connection and try again; what you typed is still here.";
export const DATE = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "short", day: "numeric", year: "numeric" });

export async function attempt(action: () => Promise<ForumSaveResult>): Promise<ForumSaveResult> {
  try {
    return await action();
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

