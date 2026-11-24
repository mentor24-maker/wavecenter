/**
 * Meetings kept in memory, for core's tests. Like the database, deleting a
 * meeting takes its invitations with it, and a member is invited at most once;
 * the rules about who may plan a meeting are core's, so this store does not
 * repeat them. Nothing about meetings is scored.
 */
import type { Meeting, MeetingFields, MeetingStore } from './meetings.ts';

export class MemoryMeetingStore implements MeetingStore {
  readonly meetings = new Map<string, Meeting>();
  /** meeting id → invited member ids, with the tool that invited each. */
  readonly invites = new Map<string, Map<string, string>>();
  /** Set to make the next write fail the way a refused write does. */
  failNextSave = false;
  /** Who is signed in, as `auth.uid()` is for the table. */
  signedIn: string | null = null;
  private next = 1;

  private failed() {
    if (!this.failNextSave) return false;
    this.failNextSave = false;
    return true;
  }

  async get(id: string) {
    return this.meetings.get(id) ?? null;
  }

  async insert(teamId: string, fields: MeetingFields, tool: string) {
    if (this.failed()) return null;
    const meeting: Meeting = { id: `meeting-${this.next++}`, teamId, ...fields, tool, createdAt: new Date().toISOString(), createdBy: this.signedIn };
    this.meetings.set(meeting.id, meeting);
    return meeting;
  }

  async update(id: string, fields: MeetingFields, tool: string) {
    const meeting = this.meetings.get(id);
    if (!meeting || this.failed()) return null;
    const saved = { ...meeting, ...fields, tool };
    this.meetings.set(id, saved);
    return saved;
  }

  async remove(id: string) {
    if (this.failed() || !this.meetings.has(id)) return false;
    this.invites.delete(id);
    return this.meetings.delete(id);
  }

  async invitees(meetingId: string) {
    return [...(this.invites.get(meetingId)?.keys() ?? [])];
  }

  async invite(meetingId: string, memberId: string, tool: string) {
    if (!this.meetings.has(meetingId) || this.failed()) return false;
    let on = this.invites.get(meetingId);
    if (!on) this.invites.set(meetingId, (on = new Map()));
    on.set(memberId, tool);
    return true;
  }

  async uninvite(meetingId: string, memberId: string) {
    if (this.failed()) return false;
    return this.invites.get(meetingId)?.delete(memberId) ?? false;
  }
}
