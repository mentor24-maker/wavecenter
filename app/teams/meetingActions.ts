"use server";

/**
 * Planning, changing and deleting a team's meetings and who is invited, run
 * on the server through core (core/meetings.ts) as the tool `wavecenter`.
 *
 * Returns `{ ok: true }` only after the database confirmed the change.
 * Anything else comes back as `{ ok: false, error }` in plain words, and the
 * screen shows it without calling anything saved (engineering rule 6). When
 * a meeting saved but its invitations did not, the answer is marked
 * `invitesFailed` and carries the meeting's id, so the screen says the meeting
 * saved (never "not saved") and the next Save changes it rather than making
 * another.
 */
import { revalidatePath } from "next/cache";
import {
  createMeeting, deleteMeeting, setMeetingInvites, updateMeeting, type MeetingDeps, type MeetingInput,
} from "../../core/meetings.ts";
import { CoreError, WAVECENTER_TOOL } from "../../core/tool.ts";
import { supabaseMeetingStore } from "../lib/meetingStore";
import { currentUser, supabaseForRequest } from "../lib/supabase";
import { supabaseTeamStore } from "../lib/teamStore";
import type { MeetingSaveFailure } from "./meetingView";

export type MeetingSaveResult = { ok: true; meetingId: string } | MeetingSaveFailure;
export type MeetingDeleteResult = { ok: true } | { ok: false; error: string };

type Signed = { deps: MeetingDeps; actorId: string } | { error: string };

async function signIn(what: string): Promise<Signed> {
  const supabase = await supabaseForRequest();
  if (!supabase) return { error: "This copy of WaveCenter has no database settings, so nothing can be saved." };
  const { user, checkFailed } = await currentUser(supabase);
  if (!user) {
    return {
      error: checkFailed
        ? `WaveCenter could not check that you are signed in, so the ${what} did not happen. Try again in a minute.`
        : `You are signed out, so the ${what} did not happen. Reload the page and log in again.`,
    };
  }
  return { deps: { meetings: supabaseMeetingStore(supabase), teams: supabaseTeamStore(supabase) }, actorId: user.id };
}

function plain(err: unknown, what: string): string {
  if (err instanceof CoreError) return err.message;
  console.error(`meetings: the ${what} failed:`, err);
  return `The ${what} did not happen. Nothing was saved; try again.`;
}

/**
 * Save a meeting (a new one when `meetingId` is null) for `teamId`, then make
 * its invitations exactly `invitees`.
 */
export async function saveMeetingAction(
  meetingId: string | null,
  teamId: string,
  input: MeetingInput,
  invitees: string[],
): Promise<MeetingSaveResult> {
  let signed: Signed;
  try {
    signed = await signIn("save");
  } catch (err) {
    return { ok: false, error: plain(err, "save") };
  }
  if ("error" in signed) return { ok: false, error: signed.error };
  const { deps, actorId } = signed;

  let savedId: string;
  try {
    const saved = meetingId
      ? await updateMeeting(deps, { actorId, meetingId, ...input }, WAVECENTER_TOOL)
      : await createMeeting(deps, { actorId, teamId, ...input }, WAVECENTER_TOOL);
    savedId = saved.id;
  } catch (err) {
    return { ok: false, error: plain(err, "save") };
  }
  revalidatePath("/teams");

  try {
    await setMeetingInvites(deps, { actorId, meetingId: savedId, memberIds: invitees }, WAVECENTER_TOOL);
  } catch (err) {
    // The meeting itself is saved, so this answer must not say "nothing was saved".
    let why: string;
    if (err instanceof CoreError) why = err.message;
    else {
      console.error("meetings: the invitations failed:", err);
      why = "the database did not take them";
    }
    return { ok: false, meetingId: savedId, invitesFailed: true, error: why };
  }
  return { ok: true, meetingId: savedId };
}

export async function deleteMeetingAction(meetingId: string): Promise<MeetingDeleteResult> {
  try {
    const signed = await signIn("delete");
    if ("error" in signed) return { ok: false, error: signed.error };
    await deleteMeeting(signed.deps, { actorId: signed.actorId, meetingId }, WAVECENTER_TOOL);
  } catch (err) {
    return { ok: false, error: plain(err, "delete") };
  }
  revalidatePath("/teams");
  return { ok: true };
}
