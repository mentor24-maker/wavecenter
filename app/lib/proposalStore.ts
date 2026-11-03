/**
 * The app's `ProposalStore` (core/proposals.ts): how core reaches the
 * `proposals` table from a page or server action. It acts through the
 * signed-in member's own session, so row-level security decides which rows it
 * can see and change. Every member may read every proposal, but `get` asks
 * only for the member's own, because core's `get` means "a proposal the
 * caller may change".
 *
 * It only translates between core's names and the table's columns, and turns
 * a failed database call into a thrown error. Every value it writes was
 * decided and checked in core.
 */
import type { NewProposalRow, Proposal, ProposalStore } from "../../core/proposals.ts";
import type { supabaseForRequest } from "./supabase";

type Client = NonNullable<Awaited<ReturnType<typeof supabaseForRequest>>>;

const COLUMNS: Record<keyof NewProposalRow, string> = {
  title: "title",
  notes: "notes",
  status: "status",
  parentProposalId: "parent_proposal_id",
  points: "points",
  position: "position",
  priority: "priority",
  tool: "tool",
};

function toRow(fields: Partial<NewProposalRow>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) row[COLUMNS[key as keyof NewProposalRow]] = value;
  return row;
}

function fromRow(row: any): Proposal {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    ownerId: row.owner_id,
    status: row.status,
    parentProposalId: row.parent_proposal_id,
    points: row.points,
    position: row.position,
    priority: row.priority,
    tool: row.tool,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function failed(what: string, error: { message: string }): never {
  throw new Error(`The database refused to ${what}: ${error.message}`);
}

/** Every member's proposals, in their order and then oldest first. A failed read throws, so a page never mistakes it for "none". */
export async function listProposals(supabase: Client): Promise<Proposal[]> {
  const { data, error } = await supabase.from("proposals").select().order("position").order("created_at");
  if (error) failed("read the proposals", error);
  return (data ?? []).map(fromRow);
}

export function supabaseProposalStore(supabase: Client, memberId: string): ProposalStore {
  return {
    async insert(row) {
      const { data, error } = await supabase.from("proposals").insert(toRow(row)).select().single();
      if (error) failed("add the proposal", error);
      return fromRow(data);
    },
    async get(id) {
      const { data, error } = await supabase.from("proposals").select().eq("id", id).eq("owner_id", memberId).maybeSingle();
      if (error) failed("read the proposal", error);
      return data ? fromRow(data) : null;
    },
    async update(id, changes) {
      const { data, error } = await supabase.from("proposals").update(toRow(changes)).eq("id", id).eq("owner_id", memberId).select();
      if (error) failed("save the change", error);
      return data?.[0] ? fromRow(data[0]) : null;
    },
    async remove(id) {
      const { data, error } = await supabase.from("proposals").delete().eq("id", id).eq("owner_id", memberId).select("id");
      if (error) failed("delete the proposal", error);
      return (data?.length ?? 0) > 0;
    },
  };
}
