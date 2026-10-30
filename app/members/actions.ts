"use server";

/**
 * Changing a member's role, run on the server through core (setMemberRole)
 * as the tool `wavecenter`.
 *
 * Returns `{ ok: true, role }` only after the database confirmed the change.
 * Anything else comes back as `{ ok: false, error }` in plain words, and the
 * picker shows it without calling anything saved (engineering rule 6).
 */
import { revalidatePath } from "next/cache";
import { setMemberRole, type RoleKey } from "../../core/members.ts";
import { CoreError, WAVECENTER_TOOL } from "../../core/tool.ts";
import { supabaseMemberRoleStore } from "../lib/memberRoleStore";
import { currentUser, supabaseForRequest } from "../lib/supabase";

export type RoleSaveResult = { ok: true; role: RoleKey } | { ok: false; error: string };

export async function changeMemberRole(memberId: string, role: string): Promise<RoleSaveResult> {
  let saved: RoleKey;
  try {
    const supabase = await supabaseForRequest();
    if (!supabase) return { ok: false, error: "This copy of WaveCenter has no database settings, so nothing can be saved." };
    const { user, checkFailed } = await currentUser(supabase);
    if (!user) {
      return {
        ok: false,
        error: checkFailed
          ? "WaveCenter could not check that you are signed in, so the role was not changed. Try again in a minute."
          : "You are signed out, so the role was not changed. Reload the page and log in again.",
      };
    }
    saved = await setMemberRole(supabaseMemberRoleStore(supabase), { actorId: user.id, memberId, role }, WAVECENTER_TOOL);
  } catch (err) {
    if (err instanceof CoreError) return { ok: false, error: err.message };
    console.error("members: could not change a role:", err);
    return { ok: false, error: "Could not change the role. Nothing was saved; try again." };
  }
  revalidatePath("/members");
  return { ok: true, role: saved };
}
