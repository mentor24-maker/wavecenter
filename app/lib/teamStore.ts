/**
 * The app's `TeamStore` (core/teams.ts): how core reaches teams. It acts
 * through the member's session, so row-level security decides what it may
 * read and change (every role reads; admins and editors change), repeating
 * core's rules.
 *
 * It only translates names and turns a failed database call into a thrown
 * error. Every value it writes was decided and checked in core.
 */
import { CoreError } from "../../core/tool.ts";
import { slugTakenMessage, type Team, type TeamStore } from "../../core/teams.ts";
import type { supabaseForRequest } from "./supabase";

type Client = NonNullable<Awaited<ReturnType<typeof supabaseForRequest>>>;

const COLUMNS = "id,name,slug,description,tool,created_at,created_by";

function fromRow(r: any): Team {
  return { id: r.id, name: r.name, slug: r.slug, description: r.description, tool: r.tool, createdAt: r.created_at, createdBy: r.created_by };
}

/** Postgres's code for a unique value used twice: here, a slug another manager took a moment ago. */
const UNIQUE_VIOLATION = "23505";

export function supabaseTeamStore(supabase: Client): TeamStore {
  return {
    async get(id) {
      const { data, error } = await supabase.from("teams").select(COLUMNS).eq("id", id).maybeSingle();
      if (error) throw new Error(`The database refused to read a team: ${error.message}`);
      return data ? fromRow(data) : null;
    },
    async slugInUse(slug, exceptId) {
      let query = supabase.from("teams").select("id", { count: "exact", head: true }).eq("slug", slug);
      if (exceptId) query = query.neq("id", exceptId);
      const { count, error } = await query;
      if (error) throw new Error(`The database refused to check the slug: ${error.message}`);
      return (count ?? 0) > 0;
    },
    async insert(fields, tool) {
      const { data, error } = await supabase.from("teams").insert({ ...fields, tool }).select(COLUMNS).maybeSingle();
      if (error?.code === UNIQUE_VIOLATION) throw new CoreError(slugTakenMessage(fields.slug));
      if (error) throw new Error(`The database refused to make the team: ${error.message}`);
      return data ? fromRow(data) : null;
    },
    async update(id, fields, tool) {
      const { data, error } = await supabase.from("teams").update({ ...fields, tool }).eq("id", id).select(COLUMNS).maybeSingle();
      if (error?.code === UNIQUE_VIOLATION) throw new CoreError(slugTakenMessage(fields.slug));
      if (error) throw new Error(`The database refused to change the team: ${error.message}`);
      return data ? fromRow(data) : null;
    },
    async remove(id) {
      const { data, error } = await supabase.from("teams").delete().eq("id", id).select("id");
      if (error) throw new Error(`The database refused to delete the team: ${error.message}`);
      return (data ?? []).length > 0;
    },
    async hasMember(teamId, memberId) {
      const { count, error } = await supabase
        .from("team_members")
        .select("member_id", { count: "exact", head: true })
        .eq("team_id", teamId)
        .eq("member_id", memberId);
      if (error) throw new Error(`The database refused to read the team's members: ${error.message}`);
      return (count ?? 0) > 0;
    },
    async addMember(teamId, memberId, tool) {
      const { data, error } = await supabase.from("team_members").insert({ team_id: teamId, member_id: memberId, tool }).select("member_id");
      if (error) throw new Error(`The database refused to add the member: ${error.message}`);
      return (data ?? []).length > 0;
    },
    async removeMember(teamId, memberId) {
      const { data, error } = await supabase.from("team_members").delete().eq("team_id", teamId).eq("member_id", memberId).select("member_id");
      if (error) throw new Error(`The database refused to remove the member: ${error.message}`);
      return (data ?? []).length > 0;
    },
  };
}

/** Every team, A–Z by name. */
export async function listTeams(supabase: Client): Promise<Team[]> {
  const { data, error } = await supabase.from("teams").select(COLUMNS).order("name");
  if (error) throw new Error(`The database refused to list the teams: ${error.message}`);
  return (data ?? []).map(fromRow);
}

/** One member of one team: only what their profile lets other members see. */
export interface TeamMemberRow {
  teamId: string;
  memberId: string;
  /** Null when their profile is private. */
  avatar: string | null;
  /** Set only when their profile is public and has a name. */
  displayName: string | null;
}

/** Every team's members, through the database's `list_team_members`, which applies each member's privacy. */
export async function listTeamMembers(supabase: Client): Promise<TeamMemberRow[]> {
  const { data, error } = await supabase.rpc("list_team_members");
  if (error) throw new Error(`The database refused to list the teams' members: ${error.message}`);
  return ((data ?? []) as any[]).map((r) => ({ teamId: r.team_id, memberId: r.member_id, avatar: r.avatar, displayName: r.display_name }));
}
