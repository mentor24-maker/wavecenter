/**
 * The words the Meeting Manager shows after a Save that did not fully land.
 * Kept apart from the component so a test can pin them (engineering rule 6:
 * never call a change saved unless the database took it, and never call it
 * not saved when the database did take it).
 */

/** What a failed Save returns; `invitesFailed` means the meeting itself saved. */
export type MeetingSaveFailure = { ok: false; error: string; meetingId?: string; invitesFailed?: boolean };

function withoutFinalStop(text: string): string {
  return text.trim().replace(/[.!]+$/, "");
}

/** The one message shown under the form after a Save that did not fully land. */
export function saveFailureText(result: MeetingSaveFailure): string {
  if (result.invitesFailed && result.meetingId) {
    return `The meeting saved, but the invitations did not: ${withoutFinalStop(result.error)}. Save again to retry the invitations.`;
  }
  return `Not saved. ${result.error}`;
}
