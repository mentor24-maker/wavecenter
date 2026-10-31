"use server";

/**
 * The Members page's actions, run on the server through core as the tool
 * `wavecenter`: changing a member's role (setMemberRole) and messaging a
 * member (sendMessage).
 *
 * Each reports success only after the database confirmed it. Anything else
 * comes back as `{ ok: false, error }` in plain words, and the screen shows it
 * without calling anything saved (engineering rule 6).
 */
import { revalidatePath } from "next/cache";
import { setMemberRole, type RoleKey } from "../../core/members.ts";
import { sendMessage } from "../../core/messages.ts";
import { CoreError, WAVECENTER_TOOL } from "../../core/tool.ts";
import { resendMailer } from "../lib/mailer";
import { readRolesAndPermissions, supabaseMemberRoleStore } from "../lib/memberRoleStore";
import { supabaseMessageStore } from "../lib/messageStore";
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

export type MessageSendResult =
  | { ok: true; emailed: true }
  | { ok: true; emailed: false; reason: string }
  | { ok: false; error: string };

/**
 * An admin's message to a member, run on the server through core
 * (sendMessage) as the tool `wavecenter`: saved, then emailed. The
 * recipient's email address is read and used here on the server; it is never
 * part of what comes back.
 *
 * `{ ok: true, emailed: true }` only when the message saved and the email
 * service took the email. A saved message whose email failed says so, with
 * the reason. Anything else means nothing was saved or sent.
 */
export async function sendMemberMessage(recipientId: string, subject: string, body: string): Promise<MessageSendResult> {
  try {
    const supabase = await supabaseForRequest();
    if (!supabase) return { ok: false, error: "This copy of WaveCenter has no database settings, so nothing was sent." };
    const { user, checkFailed } = await currentUser(supabase);
    if (!user) {
      return {
        ok: false,
        error: checkFailed
          ? "WaveCenter could not check that you are signed in, so nothing was sent. Try again in a minute."
          : "You are signed out, so nothing was sent. Reload the page and log in again.",
      };
    }
    // The database's grants when they can be read; the starting ones
    // otherwise. send_message checks the database's own either way.
    const grants = await readRolesAndPermissions(supabase).then((l) => l.grants, () => undefined);
    const outcome = await sendMessage(
      { roles: supabaseMemberRoleStore(supabase), messages: supabaseMessageStore(supabase) },
      resendMailer(),
      { senderId: user.id, recipientId, subject, body, grants },
      WAVECENTER_TOOL,
    );
    if (!outcome.recorded) console.error(`members: message ${outcome.id} was saved but its email result was not recorded.`);
    return outcome.emailed ? { ok: true, emailed: true } : { ok: true, emailed: false, reason: outcome.reason };
  } catch (err) {
    if (err instanceof CoreError) return { ok: false, error: err.message };
    console.error("members: could not send a message:", err);
    return { ok: false, error: "Could not save the message, so nothing was sent. Try again." };
  }
}
