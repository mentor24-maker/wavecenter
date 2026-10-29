"use server";

/**
 * Saving the signed-in member's profile, run on the server through core
 * (saveProfile) as the tool `wavecenter`.
 *
 * Returns `{ ok: true, profile }` only after the database confirmed the
 * write, and `profile` is what the database holds. Anything else comes back
 * as `{ ok: false, error }` in plain words, and the form shows it without
 * calling anything saved (engineering rule 6). The database scores the save
 * in the engagement ledger in the same step (core/game.ts); if that fails,
 * the save fails with it.
 */
import { revalidatePath } from "next/cache";
import { saveProfile, type MemberProfile, type ProfileInput } from "../../core/profiles.ts";
import { CoreError, WAVECENTER_TOOL } from "../../core/tool.ts";
import { supabaseMemberProfileStore } from "../lib/memberProfileStore";
import { currentUser, supabaseForRequest } from "../lib/supabase";

export type ProfileSaveResult = { ok: true; profile: MemberProfile } | { ok: false; error: string };

export async function saveMyProfile(input: ProfileInput): Promise<ProfileSaveResult> {
  let profile: MemberProfile;
  try {
    const supabase = await supabaseForRequest();
    if (!supabase) return { ok: false, error: "This copy of WaveCenter has no database settings, so nothing can be saved." };
    const { user, checkFailed } = await currentUser(supabase);
    if (!user) {
      return {
        ok: false,
        error: checkFailed
          ? "WaveCenter could not check that you are signed in, so your profile was not saved. Try again in a minute."
          : "You are signed out, so your profile was not saved. Reload the page and log in again.",
      };
    }
    profile = await saveProfile(supabaseMemberProfileStore(supabase, user.id), input, WAVECENTER_TOOL);
  } catch (err) {
    if (err instanceof CoreError) return { ok: false, error: err.message };
    console.error("profile: could not save:", err);
    return { ok: false, error: "Could not save your profile. Nothing was saved; try again." };
  }
  revalidatePath("/profile");
  return { ok: true, profile };
}
