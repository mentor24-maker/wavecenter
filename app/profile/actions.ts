"use server";

/**
 * Saving the signed-in member's profile, run on the server through core
 * (saveProfile) as the tool `wavecenter`, and starting a change of their
 * email address (changeMyEmail). (Star and Trash on a message moved
 * to Comm with the Messages table: app/comm/messageActions.ts.)
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
import { EMAIL_CHANGE_ERRORS, emailChangeFailure, emailChangeProblem } from "../auth/authErrors";
import { supabaseMemberProfileStore } from "../lib/memberProfileStore";
import { requestOrigin } from "../lib/requestOrigin";
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

export type EmailChangeResult =
  | { ok: true; current: string | null; pending: string }
  | { ok: false; error: string };

/**
 * Start changing the signed-in member's email address (WC-255). Supabase
 * emails a confirmation link to the old and the new address ("Secure email
 * change"); the address only changes once both are opened. Until then the
 * member keeps signing in with the old one, so success here says "waiting",
 * never "changed". The account id, and everything in WaveCenter tied to it,
 * stays the same. No WaveCenter table stores the address.
 */
export async function changeMyEmail(newEmail: string): Promise<EmailChangeResult> {
  const email = String(newEmail ?? "").trim();
  try {
    const supabase = await supabaseForRequest();
    if (!supabase) return { ok: false, error: "This copy of WaveCenter has no database settings, so nothing was changed." };
    const { user, checkFailed } = await currentUser(supabase);
    if (!user) {
      return {
        ok: false,
        error: checkFailed
          ? "WaveCenter could not check that you are signed in, so nothing was changed. Try again in a minute."
          : EMAIL_CHANGE_ERRORS["signed-out"],
      };
    }
    const problem = emailChangeProblem(email, user.email);
    if (problem) return { ok: false, error: EMAIL_CHANGE_ERRORS[problem] };

    // `next=email` tells /auth/confirm to come back here once a link is opened.
    const { data, error } = await supabase.auth.updateUser(
      { email },
      { emailRedirectTo: `${await requestOrigin()}/auth/confirm?next=email` },
    );
    if (error) {
      console.error(`change email: ${error.status ?? ""} ${error.code ?? ""} ${error.message}`);
      return { ok: false, error: EMAIL_CHANGE_ERRORS[emailChangeFailure(error)] };
    }
    revalidatePath("/profile");
    return { ok: true, current: data.user?.email ?? user.email ?? null, pending: data.user?.new_email ?? email };
  } catch (err) {
    console.error("change email: could not start:", err);
    return { ok: false, error: EMAIL_CHANGE_ERRORS.failed };
  }
}
