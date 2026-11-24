import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MemoryMeetingStore } from './memoryMeetingStore.ts';
import { MemoryTeamStore } from './memoryTeamStore.ts';
import {
  MEETING_NOTES_MAX, MEETING_TITLE_MAX, MEETING_VENUE_MAX, checkMeeting, clockTime, createMeeting, deleteMeeting,
  isCalendarDate, mayPlanMeetings, monthGrid, mountainToday, setMeetingInvites, shiftMonth, updateMeeting,
  type MeetingDeps,
} from './meetings.ts';

const TOOL = 'wavecenter';
const TEAM_ID = 'team-1';

async function setup(): Promise<MeetingDeps & { meetings: MemoryMeetingStore; teams: MemoryTeamStore }> {
  const teams = new MemoryTeamStore();
  await teams.insert({ name: 'Design', slug: 'design', description: null }, 'migration');
  await teams.addMember(TEAM_ID, 'mia', 'migration');
  await teams.addMember(TEAM_ID, 'tom', 'migration');
  return { meetings: new MemoryMeetingStore(), teams };
}

const KICKOFF = { title: 'Kickoff', date: '2026-11-24', startTime: '10:00', venue: 'Zoom', notes: null };

test('checkMeeting tidies the fields and says what to fix', () => {
  assert.deepEqual(checkMeeting({ title: ' Kickoff ', date: '2026-11-24', startTime: '09:30:00', venue: '  ', notes: ' bring ideas ' }),
    { title: 'Kickoff', date: '2026-11-24', startTime: '09:30', venue: null, notes: 'bring ideas' });
  assert.throws(() => checkMeeting({ ...KICKOFF, title: '  ' }), /needs a title/);
  assert.throws(() => checkMeeting({ ...KICKOFF, title: 'x'.repeat(MEETING_TITLE_MAX + 1) }), /at most 120/);
  assert.throws(() => checkMeeting({ ...KICKOFF, date: '2026-02-30' }), /real date/);
  assert.throws(() => checkMeeting({ ...KICKOFF, date: '' }), /real date/);
  assert.throws(() => checkMeeting({ ...KICKOFF, startTime: '24:00' }), /start time/);
  assert.throws(() => checkMeeting({ ...KICKOFF, startTime: '' }), /start time/);
  assert.throws(() => checkMeeting({ ...KICKOFF, venue: 'v'.repeat(MEETING_VENUE_MAX + 1) }), /venue can be at most/);
  assert.throws(() => checkMeeting({ ...KICKOFF, notes: 'n'.repeat(MEETING_NOTES_MAX + 1) }), /notes can be at most/);
});

test('real dates only', () => {
  assert.equal(isCalendarDate('2028-02-29'), true);
  assert.equal(isCalendarDate('2027-02-29'), false);
  assert.equal(isCalendarDate('2026-13-01'), false);
  assert.equal(isCalendarDate('2026-1-01'), false);
});

test('only a member of the team plans its meetings (Dane, WC-204, "B")', async () => {
  const deps = await setup();
  assert.equal(await mayPlanMeetings(deps.teams, TEAM_ID, 'mia'), true);
  assert.equal(await mayPlanMeetings(deps.teams, TEAM_ID, 'outsider'), false);
  await assert.rejects(createMeeting(deps, { actorId: 'outsider', teamId: TEAM_ID, ...KICKOFF }, TOOL), /Only a member of this team can plan/);
  await assert.rejects(createMeeting(deps, { actorId: 'mia', teamId: 'gone', ...KICKOFF }, TOOL), /team no longer exists/);
  await assert.rejects(createMeeting(deps, { actorId: 'mia', teamId: TEAM_ID, ...KICKOFF }, '  '), /must name the tool/);
  assert.equal(deps.meetings.meetings.size, 0);
});

test('a team member makes, changes and deletes a meeting; any other team member may too', async () => {
  const deps = await setup();
  deps.meetings.signedIn = 'mia';
  const made = await createMeeting(deps, { actorId: 'mia', teamId: TEAM_ID, ...KICKOFF }, TOOL);
  assert.equal(made.teamId, TEAM_ID);
  assert.equal(made.venue, 'Zoom');
  assert.equal(made.createdBy, 'mia');
  const changed = await updateMeeting(deps, { actorId: 'tom', meetingId: made.id, ...KICKOFF, venue: 'Google Meet' }, 'other-tool');
  assert.equal(changed.venue, 'Google Meet');
  assert.equal(changed.tool, 'other-tool');
  await assert.rejects(updateMeeting(deps, { actorId: 'outsider', meetingId: made.id, ...KICKOFF }, TOOL), /Only a member of this team can change/);
  await assert.rejects(deleteMeeting(deps, { actorId: 'outsider', meetingId: made.id }, TOOL), /Only a member of this team can delete/);
  await deleteMeeting(deps, { actorId: 'tom', meetingId: made.id }, TOOL);
  assert.equal(deps.meetings.meetings.size, 0);
  await assert.rejects(updateMeeting(deps, { actorId: 'mia', meetingId: made.id, ...KICKOFF }, TOOL), /meeting no longer exists/);
});

test('a save the store refused is never called saved (engineering rule 6)', async () => {
  const deps = await setup();
  deps.meetings.failNextSave = true;
  await assert.rejects(createMeeting(deps, { actorId: 'mia', teamId: TEAM_ID, ...KICKOFF }, TOOL), /did not save/);
  const made = await createMeeting(deps, { actorId: 'mia', teamId: TEAM_ID, ...KICKOFF }, TOOL);
  deps.meetings.failNextSave = true;
  await assert.rejects(updateMeeting(deps, { actorId: 'mia', meetingId: made.id, ...KICKOFF, title: 'Renamed' }, TOOL), /did not save/);
  assert.equal((await deps.meetings.get(made.id))?.title, 'Kickoff');
  deps.meetings.failNextSave = true;
  await assert.rejects(deleteMeeting(deps, { actorId: 'mia', meetingId: made.id }, TOOL), /not deleted/);
  assert.ok(await deps.meetings.get(made.id));
});

test('a team member invites anyone, including members of no team, and uninvites them', async () => {
  const deps = await setup();
  const made = await createMeeting(deps, { actorId: 'mia', teamId: TEAM_ID, ...KICKOFF }, TOOL);
  assert.deepEqual((await setMeetingInvites(deps, { actorId: 'mia', meetingId: made.id, memberIds: ['tom', 'outsider', 'tom'] }, TOOL)).sort(), ['outsider', 'tom']);
  assert.equal(deps.meetings.invites.get(made.id)?.get('outsider'), TOOL);
  assert.deepEqual(await setMeetingInvites(deps, { actorId: 'tom', meetingId: made.id, memberIds: ['outsider', ''] }, TOOL), ['outsider']);
  await assert.rejects(setMeetingInvites(deps, { actorId: 'outsider', meetingId: made.id, memberIds: [] }, TOOL), /Only a member of this team can invite/);
  assert.deepEqual(await deps.meetings.invitees(made.id), ['outsider']);
  deps.meetings.failNextSave = true;
  await assert.rejects(setMeetingInvites(deps, { actorId: 'mia', meetingId: made.id, memberIds: ['outsider', 'tom'] }, TOOL), /not saved/);
  await deleteMeeting(deps, { actorId: 'mia', meetingId: made.id }, TOOL);
  assert.equal(deps.meetings.invites.has(made.id), false, 'deleting a meeting takes its invitations with it');
});

test('the calendar: Sunday-first weeks, whole months, months that roll over the year', () => {
  const nov = monthGrid(2026, 11);
  assert.equal(nov[0][0], '2026-11-01', 'Nov 1 2026 is a Sunday');
  assert.equal(nov.flat().filter(Boolean).length, 30);
  assert.ok(nov.every((w) => w.length === 7));
  const feb = monthGrid(2027, 2);
  assert.deepEqual(feb[0].slice(0, 1), [null], 'Feb 1 2027 is a Monday');
  assert.equal(feb[0][1], '2027-02-01');
  assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
});

test('today is Mountain time, and times read on a 12-hour clock', () => {
  // 03:00 UTC on Nov 23 is still the evening of Nov 22 in Denver.
  assert.equal(mountainToday(new Date('2026-11-23T03:00:00Z')), '2026-11-22');
  assert.equal(mountainToday(new Date('2026-11-23T08:00:00Z')), '2026-11-23');
  assert.equal(clockTime('00:05'), '12:05 AM');
  assert.equal(clockTime('12:00'), '12:00 PM');
  assert.equal(clockTime('14:30:00'), '2:30 PM');
});

test('the migration matches core: limits, row-level security on both tables, team-only changes', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261123120000_meetings.sql', import.meta.url), 'utf8');
  assert.match(sql, new RegExp(`length\\(btrim\\(title\\)\\) between 1 and ${MEETING_TITLE_MAX}\\b`));
  assert.match(sql, new RegExp(`length\\(venue\\) <= ${MEETING_VENUE_MAX}\\b`));
  assert.match(sql, new RegExp(`length\\(notes\\) <= ${MEETING_NOTES_MAX}\\b`));
  assert.match(sql, /alter table public\.meetings\s+enable row level security/);
  assert.match(sql, /alter table public\.meeting_invites enable row level security/);
  assert.match(sql, /grant update \(title, meets_on, start_time, venue, notes, tool\) on public\.meetings/);
  assert.doesNotMatch(sql, /grant update[^;]*team_id/);
});
