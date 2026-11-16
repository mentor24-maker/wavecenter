/**
 * The app's `ForumStore` (core/forum.ts): how core reaches the
 * `forum_topics` and `forum_tags` tables from a page or server action. It
 * acts through the signed-in member's own session, so row-level security
 * decides what it may read and add.
 *
 * It only translates between core's names and the tables' columns, and turns
 * a failed database call into a thrown error. Every value it writes was
 * decided and checked in core.
 */
import { CoreError } from "../../core/tool.ts";
import { findForumEntryByName, type ForumEntry, type ForumKind, type ForumStore } from "../../core/forum.ts";
import type { supabaseForRequest } from "./supabase";

type Client = NonNullable<Awaited<ReturnType<typeof supabaseForRequest>>>;

const TABLE: Record<ForumKind, string> = { topic: "forum_topics", tag: "forum_tags" };
const PLURAL: Record<ForumKind, string> = { topic: "topics", tag: "tags" };

function fromRow(kind: ForumKind, row: any): ForumEntry {
  return { id: row.id, kind, name: row.name, createdBy: row.created_by, tool: row.tool, createdAt: row.created_at };
}

function failed(what: string, error: { message: string }): never {
  throw new Error(`The database refused to ${what}: ${error.message}`);
}

/** Every topic or every tag, A to Z. A failed read throws, so a page never mistakes it for "none". */
export async function listForumEntries(supabase: Client, kind: ForumKind): Promise<ForumEntry[]> {
  const { data, error } = await supabase.from(TABLE[kind]).select("id, name, created_by, tool, created_at").order("name");
  if (error) failed(`read the ${PLURAL[kind]}`, error);
  return (data ?? []).map((row) => fromRow(kind, row));
}

export function supabaseForumStore(supabase: Client): ForumStore {
  return {
    async insert(kind, row) {
      const { data, error } = await supabase.from(TABLE[kind]).insert({ name: row.name, tool: row.tool }).select().single();
      // 23505: the unique name rule. Another member added the same name a moment ago.
      if (error?.code === "23505") throw new CoreError(`There is already a ${kind} called "${row.name}".`);
      if (error) failed(`add the ${kind}`, error);
      return fromRow(kind, data);
    },
    async findByName(kind, name) {
      // Read the list and compare in code. Not ilike: PostgREST turns every
      // "*" in an ilike pattern into a wildcard, so "Q*" matched "Quorum".
      // The unique index still refuses a duplicate that slips in between.
      return findForumEntryByName(await listForumEntries(supabase, kind), name);
    },
  };
}
