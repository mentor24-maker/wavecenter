/**
 * Meetings: a team's planned get-togethers (Dane, 2026-11-22, WC-204, "Add a
 * Meeting Manager to the Teams page": "a dropdown selector for the team, a
 * calendar table with clickable dates to pop-up a meeting details page. In
 * that page, include a field for details about the venue (e.g. Zoom, Google
 * Meet, etc.) and the ability to invite members").
 *
 * Who may do what (Dane, on WC-204, "B": any member of that team, inviting
 * anyone): every role that may view teams sees every meeting; a member of a
 * meeting's team makes, changes and deletes it and invites and uninvites
 * members; anyone with a WaveCenter account may be invited. An invitation is
 * only recorded; nothing is sent.
 *
 * A meeting's date and start time are Mountain time, kept as typed.
 *
 * Like teams (core/teams.ts), meetings are reached through a store a client
 * supplies, and every change names its tool. The database's row-level
 * security repeats who may do what (supabase/migrations/20261123120000_meetings.sql).
 */
import type { TeamStore } from './teams.ts';
import { CoreError, requireTool } from './tool.ts';

/** The longest title, venue and notes a meeting holds. The migration checks the same. */
export const MEETING_TITLE_MAX = 120;
export const MEETING_VENUE_MAX = 300;
export const MEETING_NOTES_MAX = 2000;

/** One meeting, in core's own names. */
export interface Meeting {
  id: string;
  teamId: string;
  title: string;
  /** The Mountain time date, "YYYY-MM-DD". */
  date: string;
  /** The Mountain time start, "HH:MM" on a 24-hour clock. */
  startTime: string;
  /** Where it happens, in the planner's words ("Zoom", a link, a room). Null means not said. */
  venue: string | null;
  /** Null means none. */
  notes: string | null;
  /** The tool that last changed this record. */
  tool: string;
  createdAt: string;
  /** Null once the member who made it has left. */
  createdBy: string | null;
}

/** What a planner asks to save. A blank venue or notes means none. */
export interface MeetingInput {
  title: string;
  date: string;
  startTime: string;
  venue: string | null;
  notes: string | null;
}

/** A meeting's fields once core has checked and tidied them. */
export type MeetingFields = Pick<Meeting, 'title' | 'date' | 'startTime' | 'venue' | 'notes'>;

/** What core needs from storage for meetings. */
export interface MeetingStore {
  get(id: string): Promise<Meeting | null>;
  /** Make the meeting. Returns what was saved, or null if nothing was. */
  insert(teamId: string, fields: MeetingFields, tool: string): Promise<Meeting | null>;
  /** Change the meeting. Returns what is now saved, or null if nothing was. */
  update(id: string, fields: MeetingFields, tool: string): Promise<Meeting | null>;
  /** Delete the meeting and its invitations. True only if a meeting was deleted. */
  remove(id: string): Promise<boolean>;
  /** The ids of the members invited to the meeting. */
  invitees(meetingId: string): Promise<string[]>;
  /** True only if the member is now invited. */
  invite(meetingId: string, memberId: string, tool: string): Promise<boolean>;
  /** True only if an invitation was removed. */
  uninvite(meetingId: string, memberId: string): Promise<boolean>;
}

/** What a meeting change needs: the meetings, and the teams (to know who is on which). */
export interface MeetingDeps {
  meetings: MeetingStore;
  teams: TeamStore;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Is this a real calendar date written "YYYY-MM-DD"? */
export function isCalendarDate(value: string): boolean {
  const m = DATE_PATTERN.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || y > 9999 || mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

/** How many days the month has (month 1–12). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Check and tidy what a planner typed. Throws a CoreError saying what to fix. */
export function checkMeeting(input: MeetingInput): MeetingFields {
  const title = (input.title ?? '').trim();
  if (!title) throw new CoreError('A meeting needs a title.');
  if (title.length > MEETING_TITLE_MAX) throw new CoreError(`A meeting title can be at most ${MEETING_TITLE_MAX} characters.`);
  const date = (input.date ?? '').trim();
  if (!isCalendarDate(date)) throw new CoreError('A meeting needs a real date.');
  const startTime = (input.startTime ?? '').trim().slice(0, 5);
  if (!TIME_PATTERN.test(startTime)) throw new CoreError('A meeting needs a start time, for example 10:00.');
  const venue = (input.venue ?? '').trim() || null;
  if (venue && venue.length > MEETING_VENUE_MAX) throw new CoreError(`A venue can be at most ${MEETING_VENUE_MAX} characters.`);
  const notes = (input.notes ?? '').trim() || null;
  if (notes && notes.length > MEETING_NOTES_MAX) throw new CoreError(`Meeting notes can be at most ${MEETING_NOTES_MAX} characters.`);
  return { title, date, startTime, venue, notes };
}

/** May `memberId` plan meetings for the team? Only its own members may (Dane, WC-204, "B"). */
export async function mayPlanMeetings(teams: TeamStore, teamId: string, memberId: string): Promise<boolean> {
  return teams.hasMember(teamId, memberId);
}

async function requirePlanner(deps: MeetingDeps, teamId: string, actorId: string, doing: string): Promise<void> {
  if (!(await deps.teams.get(teamId))) {
    throw new CoreError('That team no longer exists. Reload the page to see the teams as they are now.');
  }
  if (!(await mayPlanMeetings(deps.teams, teamId, actorId))) {
    throw new CoreError(`Only a member of this team can ${doing}.`);
  }
}

async function requireMeeting(deps: MeetingDeps, meetingId: string): Promise<Meeting> {
  const meeting = await deps.meetings.get(meetingId);
  if (!meeting) throw new CoreError('That meeting no longer exists. Reload the page to see the meetings as they are now.');
  return meeting;
}

function sameFields(saved: Meeting, fields: MeetingFields): boolean {
  return (
    saved.title === fields.title &&
    saved.date === fields.date &&
    saved.startTime === fields.startTime &&
    saved.venue === fields.venue &&
    saved.notes === fields.notes
  );
}

/** `actorId` plans a meeting for a team they are on, on behalf of `tool`. */
export async function createMeeting(
  deps: MeetingDeps,
  change: { actorId: string; teamId: string } & MeetingInput,
  tool: string,
): Promise<Meeting> {
  const named = requireTool(tool);
  const fields = checkMeeting(change);
  await requirePlanner(deps, change.teamId, change.actorId, 'plan its meetings');
  const saved = await deps.meetings.insert(change.teamId, fields, named);
  if (!saved || saved.teamId !== change.teamId || !sameFields(saved, fields)) {
    throw new CoreError('The meeting did not save. Nothing changed; try again.');
  }
  return saved;
}

/** `actorId` changes a meeting of a team they are on, on behalf of `tool`. */
export async function updateMeeting(
  deps: MeetingDeps,
  change: { actorId: string; meetingId: string } & MeetingInput,
  tool: string,
): Promise<Meeting> {
  const named = requireTool(tool);
  const fields = checkMeeting(change);
  const meeting = await requireMeeting(deps, change.meetingId);
  await requirePlanner(deps, meeting.teamId, change.actorId, 'change its meetings');
  const saved = await deps.meetings.update(change.meetingId, fields, named);
  if (!saved || !sameFields(saved, fields)) throw new CoreError('The change did not save. The meeting is as it was; try again.');
  return saved;
}

/** `actorId` deletes a meeting of a team they are on, and its invitations, on behalf of `tool`. */
export async function deleteMeeting(deps: MeetingDeps, change: { actorId: string; meetingId: string }, tool: string): Promise<void> {
  requireTool(tool);
  const meeting = await requireMeeting(deps, change.meetingId);
  await requirePlanner(deps, meeting.teamId, change.actorId, 'delete its meetings');
  if (!(await deps.meetings.remove(change.meetingId))) throw new CoreError('The meeting was not deleted. Try again.');
}

/**
 * `actorId` makes the meeting's invitations exactly `memberIds` (anyone with
 * an account; Dane, WC-204, "B"), on behalf of `tool`: it invites the new
 * ones, uninvites the dropped ones, then reads the list back. Returns who is
 * invited now.
 */
export async function setMeetingInvites(
  deps: MeetingDeps,
  change: { actorId: string; meetingId: string; memberIds: readonly string[] },
  tool: string,
): Promise<string[]> {
  const named = requireTool(tool);
  const meeting = await requireMeeting(deps, change.meetingId);
  await requirePlanner(deps, meeting.teamId, change.actorId, 'invite members to its meetings');
  const wanted = new Set(change.memberIds.filter((id) => typeof id === 'string' && id.trim() !== ''));
  const before = new Set(await deps.meetings.invitees(change.meetingId));
  for (const id of before) {
    if (!wanted.has(id) && !(await deps.meetings.uninvite(change.meetingId, id))) {
      throw new CoreError('An invitation was not removed. Reload the page to see who is invited now, then try again.');
    }
  }
  for (const id of wanted) {
    if (!before.has(id) && !(await deps.meetings.invite(change.meetingId, id, named))) {
      throw new CoreError('An invitation was not saved. Reload the page to see who is invited now, then try again.');
    }
  }
  const after = await deps.meetings.invitees(change.meetingId);
  if (after.length !== wanted.size || after.some((id) => !wanted.has(id))) {
    throw new CoreError('The invitations did not all save. Reload the page to see who is invited now, then try again.');
  }
  return after;
}

/** Today's date in Mountain time, "YYYY-MM-DD". */
export function mountainToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/**
 * A month laid out as a calendar, Sunday first: weeks of seven cells, each
 * "YYYY-MM-DD" or null for a day outside the month.
 */
export function monthGrid(year: number, month: number): (string | null)[][] {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const days = daysInMonth(year, month);
  const cells: (string | null)[] = Array.from({ length: first }, () => null);
  for (let d = 1; d <= days; d++) cells.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** The month before or after (month 1–12), by `step` months. */
export function shiftMonth(year: number, month: number, step: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + step;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** "10:00" → "10:00 AM", "14:30" → "2:30 PM": how a start time reads on screen (Mountain time). */
export function clockTime(startTime: string): string {
  const m = TIME_PATTERN.exec(startTime.slice(0, 5));
  if (!m) return startTime;
  const hour = Number(m[1]);
  return `${hour % 12 === 0 ? 12 : hour % 12}:${m[2]} ${hour < 12 ? 'AM' : 'PM'}`;
}
