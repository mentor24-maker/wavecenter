"use server";

/**
 * Saving the words in one of Home's boxes, run on the server through core
 * (core/homeBoxes.ts) as the tool `wavecenter`.
 *
 * Returns `{ ok: true, body }` only after the database confirmed the change,
 * with the words now saved. Anything else comes back as `{ ok: false, error }`
 * in plain words, and the box shows it without calling anything saved
 * (engineering rule 6).
 */
import { revalidatePath } from "next/cache";
import { saveHomeBox } from "../core/homeBoxes.ts";
import { CoreError, WAVECENTER_TOOL } from "../core/tool.ts";
import { supabaseHomeBoxStore } from "./lib/homeBoxStore";
import { readRolesAndPermissions, supabaseMemberRoleStore } from "./lib/memberRoleStore";
import { currentUser, supabaseForRequest } from "./lib/supabase";

export type HomeBoxSaveResult = { ok: true; body: string } | { ok: false; error: string };

export async function saveHomeBoxAction(box: string, body: string): Promise<HomeBoxSaveResult> {
  let saved: string;
  try {
    const supabase = await supabaseForRequest();
    if (!supabase) return { ok: false, error: "This copy of WaveCenter has no database settings, so nothing can be saved." };
    const { user, checkFailed } = await currentUser(supabase);
    if (!user) {
      return {
        ok: false,
        error: checkFailed
          ? "WaveCenter could not check that you are signed in, so the words did not save. Try again in a minute."
          : "You are signed out, so the words did not save. Reload the page and log in again.",
      };
    }
    const { grants } = await readRolesAndPermissions(supabase);
    const deps = { boxes: supabaseHomeBoxStore(supabase), roles: supabaseMemberRoleStore(supabase), grants };
    saved = (await saveHomeBox(deps, { actorId: user.id, box, body }, WAVECENTER_TOOL)).body;
  } catch (err) {
    if (err instanceof CoreError) return { ok: false, error: err.message };
    console.error("home: saving a box's words failed:", err);
    return { ok: false, error: "The words did not save. The box is as it was; try again." };
  }
  revalidatePath("/");
  return { ok: true, body: saved };
}
