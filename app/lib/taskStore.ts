/**
 * The app's `TaskStore` (core/tasks.ts): how core reaches the `tasks` table
 * from a page or server action. It acts through the signed-in member's own
 * session, so row-level security decides which rows it can see and change.
 *
 * It only translates between core's names and the table's columns, and turns
 * a failed database call into a thrown error. Every value it writes was
 * decided and checked in core.
 */
import type { NewTaskRow, Task, TaskRowChanges, TaskStore } from "../../core/tasks.ts";
import type { supabaseForRequest } from "./supabase";

type Client = NonNullable<Awaited<ReturnType<typeof supabaseForRequest>>>;

const COLUMNS: Record<keyof NewTaskRow, string> = {
  title: "title",
  notes: "notes",
  status: "status",
  parentTaskId: "parent_task_id",
  points: "points",
  position: "position",
  priority: "priority",
  agentSelected: "agent_selected",
  agentTicketUrl: "agent_ticket_url",
  tool: "tool",
};

function toRow(fields: Partial<NewTaskRow>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) row[COLUMNS[key as keyof NewTaskRow]] = value;
  return row;
}

export function fromRow(row: any): Task {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    ownerId: row.owner_id,
    status: row.status,
    parentTaskId: row.parent_task_id,
    points: row.points,
    position: row.position,
    priority: row.priority,
    agentSelected: row.agent_selected,
    agentTicketUrl: row.agent_ticket_url ?? null,
    tool: row.tool,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

/**
 * A delete leaves no row to carry the tool's name, so it travels as a request
 * header; the database's game-layer trigger reads it when it scores the delete.
 */
export const TOOL_HEADER = "x-wavecenter-tool";

function failed(what: string, error: { message: string }): never {
  throw new Error(`The database refused to ${what}: ${error.message}`);
}

export function supabaseTaskStore(supabase: Client): TaskStore {
  return {
    async insert(row) {
      const { data, error } = await supabase.from("tasks").insert(toRow(row)).select().single();
      if (error) failed("add the task", error);
      return fromRow(data);
    },
    async get(id) {
      const { data, error } = await supabase.from("tasks").select().eq("id", id).maybeSingle();
      if (error) failed("read the task", error);
      return data ? fromRow(data) : null;
    },
    async update(id, changes: TaskRowChanges, guard = {}) {
      let query = supabase.from("tasks").update(toRow(changes)).eq("id", id);
      if (guard.points !== undefined) query = query.eq("points", guard.points);
      if (guard.agentTicketUrl === null) query = query.is("agent_ticket_url", null);
      else if (guard.agentTicketUrl !== undefined) query = query.eq("agent_ticket_url", guard.agentTicketUrl);
      const { data, error } = await query.select();
      if (error) failed("save the change", error);
      return data?.[0] ? fromRow(data[0]) : null;
    },
    async remove(id, tool) {
      const { data, error } = await supabase.from("tasks").delete().eq("id", id).select("id").setHeader(TOOL_HEADER, tool);
      if (error) failed("delete the task", error);
      return (data?.length ?? 0) > 0;
    },
  };
}
