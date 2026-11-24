/**
 * The app's `MeetingStore` (core/meetings.ts): how core reaches meetings. It
 * acts through the member's session, so row-level security decides what it
 * may read and change (every role that views teams reads; a team's own
 * members change), repeating core's rules.
 *
 * It only translates names and turns a failed database call into a thrown
 * error. Every value it writes was decided and checked in core.
 */
import type { Meeting, MeetingFields, MeetingStore } from "../../core/meetings.ts";
import type { supabaseForRequest } from "./supabase";

type Client = NonNullable<Awaited<ReturnType<typeof supabaseForRequest>>>;

const COLUMNS = "id,team_id,title,meets_on,start_time,venue,notes,tool,created_at,created_by";

function fromRow(r: any): Meeting {
  return {
    id: r.id,
    teamId: r.team_id,
    title: r.title,
    date: r.meets_on,
    // Postgres hands a time back as "10:00:00"; core keeps "10:00".
    startTime: String(r.start_time ?? "").slice(0, 5),
    venue: r.venue,
    notes: r.notes,
    tool: r.tool,
    createdAt: r.created_at,
    createdBy: r.created_by,
  };
}

function toRow(fields: MeetingFields, tool: string) {
  return { title: fields.title, meets_on: fields.date, start_time: fields.startTime, venue: fields.venue, notes: fields.notes, tool };
}

export function supabaseMeetingStore(supabase: Client): MeetingStore {
  return {
    async get(id) {
      const { data, error } = await supabase.from("meetings").select(COLUMNS).eq("id", id).maybeSingle();
      if (error) throw new Error(`The database refused to read a meeting: ${error.message}`);
      return data ? fromRow(data) : null;
    },
    async insert(teamId, fields, tool) {
      const { data, error } = await supabase.from("meetings").insert({ team_id: teamId, ...toRow(fields, tool) }).select(COLUMNS).maybeSingle();
      if (error) throw new Error(`The database refused to save the meeting: ${error.message}`);
      return data ? fromRow(data) : null;
    },
    async update(id, fields, tool) {
      const { data, error } = await supabase.from("meetings").update(toRow(fields, tool)).eq("id", id).select(COLUMNS).maybeSingle();
      if (error) throw new Error(`The database refused to change the meeting: ${error.message}`);
      return data ? fromRow(data) : null;
    },
    async remove(id) {
      const { data, error } = await supabase.from("meetings").delete().eq("id", id).select("id");
      if (error) throw new Error(`The database refused to delete the meeting: ${error.message}`);
      return (data ?? []).length > 0;
    },
    async invitees(meetingId) {
      const { data, error } = await supabase.from("meeting_invites").select("member_id").eq("meeting_id", meetingId);
      if (error) throw new Error(`The database refused to read who is invited: ${error.message}`);
      return (data ?? []).map((r: any) => r.member_id);
    },
    async invite(meetingId, memberId, tool) {
      const { data, error } = await supabase.from("meeting_invites").insert({ meeting_id: meetingId, member_id: memberId, tool }).select("member_id");
      if (error) throw new Error(`The database refused to save the invitation: ${error.message}`);
      return (data ?? []).length > 0;
    },
    async uninvite(meetingId, memberId) {
      const { data, error } = await supabase
        .from("meeting_invites")
        .delete()
        .eq("meeting_id", meetingId)
        .eq("member_id", memberId)
        .select("member_id");
      if (error) throw new Error(`The database refused to remove the invitation: ${error.message}`);
      return (data ?? []).length > 0;
    },
  };
}

/** One meeting with who is invited to it. */
export type MeetingWithInvites = Meeting & { invitees: string[] };

/** Every meeting, soonest first, each with its invitees. */
export async function listMeetings(supabase: Client): Promise<MeetingWithInvites[]> {
  const [meetings, invites] = await Promise.all([
    supabase.from("meetings").select(COLUMNS).order("meets_on").order("start_time"),
    supabase.from("meeting_invites").select("meeting_id,member_id").order("invited_at"),
  ]);
  if (meetings.error) throw new Error(`The database refused to list the meetings: ${meetings.error.message}`);
  if (invites.error) throw new Error(`The database refused to list who is invited: ${invites.error.message}`);
  const byMeeting = new Map<string, string[]>();
  for (const r of (invites.data ?? []) as any[]) {
    const list = byMeeting.get(r.meeting_id) ?? [];
    list.push(r.member_id);
    byMeeting.set(r.meeting_id, list);
  }
  return ((meetings.data ?? []) as any[]).map((r) => ({ ...fromRow(r), invitees: byMeeting.get(r.id) ?? [] }));
}
