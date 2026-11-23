/**
 * The app's `ForumStore` (core/forum.ts): how core reaches the
 * `forum_topics` and `forum_tags` tables from a page or server action. It
 * acts through the signed-in member's own session, so row-level security
 * decides what it may read and add.
 *
 * It only translates between core's names and the tables' columns, and turns
 * a failed database call into a thrown error. Every value it writes was
 * decided and checked in core. A topic also reads and writes its details
 * (WC-183); a change or delete that row-level security quietly skipped
 * comes back as zero rows, and that is thrown too, never taken as done
 * (engineering rule 6).
 */
import { CoreError } from "../../core/tool.ts";
import { findForumEntryByName, type ForumEntry, type ForumKind, type ForumStore, type ForumTopic, type TopicStore } from "../../core/forum.ts";
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

const TOPIC_COLUMNS = "id, name, slug, description, details, parent_id, created_by, tool, created_at, updated_at";

function topicFromRow(row: any): ForumTopic {
  return {
    ...fromRow("topic", row),
    kind: "topic",
    slug: row.slug,
    description: row.description ?? "",
    details: row.details ?? "",
    parentId: row.parent_id ?? null,
    updatedAt: row.updated_at,
  };
}

/** Every topic with its details, A to Z. A failed read throws. */
export async function listTopics(supabase: Client): Promise<ForumTopic[]> {
  const { data, error } = await supabase.from("forum_topics").select(TOPIC_COLUMNS).order("name");
  if (error) failed("read the topics", error);
  return (data ?? []).map(topicFromRow);
}

export function supabaseTopicStore(supabase: Client): TopicStore {
  return {
    listTopics: () => listTopics(supabase),
    async updateTopic(id, row) {
      const { data, error } = await supabase
        .from("forum_topics")
        .update({ name: row.name, slug: row.slug, description: row.description, details: row.details, parent_id: row.parentId })
        .eq("id", id)
        .select(TOPIC_COLUMNS);
      if (error?.code === "23505") {
        throw new CoreError(/slug/.test(error.message) ? `The slug "${row.slug}" is already used by another topic.` : `There is already a topic called "${row.name}".`);
      }
      if (error?.code === "23514" && /sub-topics|own_parent/.test(error.message)) {
        throw new CoreError("A topic cannot sit under itself or under one of its own sub-topics.");
      }
      if (error) failed("save the topic", error);
      if (!data?.length) throw new CoreError("The topic was not saved: it may have been deleted, or you may not be allowed to change it.");
      return topicFromRow(data[0]);
    },
    async setTopicParent(id, parentId) {
      const { data, error } = await supabase.from("forum_topics").update({ parent_id: parentId }).eq("id", id).select(TOPIC_COLUMNS);
      if (error?.code === "23514" && /sub-topics|own_parent/.test(error.message)) {
        throw new CoreError("A topic cannot sit under itself or under one of its own sub-topics.");
      }
      if (error?.code === "23503") throw new CoreError("The chosen parent topic was not found. It may have been deleted; choose another.");
      if (error) failed("save the parent topic", error);
      if (!data?.length) throw new CoreError("The parent topic was not saved: the topic may have been deleted, or you may not be allowed to change it.");
      return topicFromRow(data[0]);
    },
    async deleteTopic(id) {
      const { data, error } = await supabase.from("forum_topics").delete().eq("id", id).select("id");
      if (error) failed("delete the topic", error);
      if (!data?.length) throw new CoreError("The topic was not deleted: it may already be gone, or you may not be allowed to delete it.");
    },
  };
}
