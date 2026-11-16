/**
 * The Forum's topics and tags, and the only path for adding one.
 *
 * The Forum is where members collaboratively curate topics, tags and threads
 * to discuss and exchange ideas, aiming at proposals (Dane, 2026-11-04). Its
 * first section (WC-178, 2026-11-15) is two lists side by side: topics on the
 * left, tags on the right, each with its own Add box over a table. A topic
 * and a tag have the same shape: a name, who added it, the tool, and when.
 *
 * Every member reads every topic and tag and may add one. Names are unique
 * without regard to capitals or surrounding spaces. Tags are only listed for
 * now; attaching a tag to a topic, threads, and changing or deleting either
 * one come later. Core does not know about Supabase: it talks to a
 * `ForumStore`, a thin adapter a client supplies. The plain-words description
 * of the tables is docs/DATA_MODEL.md.
 */
import { CoreError, requireTool } from './tool.ts';

/** The two kinds of Forum entry, and their table words. */
export const FORUM_KINDS = ['topic', 'tag'] as const;
export type ForumKind = (typeof FORUM_KINDS)[number];

/** The longest name a topic or tag may have, in characters. */
export const FORUM_NAME_MAX = 80;

/** One row of `forum_topics` or `forum_tags`, in core's own names. */
export interface ForumEntry {
  id: string;
  kind: ForumKind;
  name: string;
  /** The member who added it; null once their account is deleted. */
  createdBy: string | null;
  tool: string;
  createdAt: string;
}

/** The fields a store writes for a new entry. The adder is the signed-in member. */
export interface NewForumEntryRow {
  name: string;
  tool: string;
}

/** What core needs from storage. Every value it writes was decided here. */
export interface ForumStore {
  insert(kind: ForumKind, row: NewForumEntryRow): Promise<ForumEntry>;
  /** The entry of this kind whose name matches, ignoring capitals and surrounding spaces; null if none. */
  findByName(kind: ForumKind, name: string): Promise<ForumEntry | null>;
}

function requireKind(kind: unknown): ForumKind {
  if (!FORUM_KINDS.includes(kind as ForumKind)) {
    throw new CoreError(`A Forum entry is a ${FORUM_KINDS.join(' or a ')}; got "${String(kind)}".`);
  }
  return kind as ForumKind;
}

/** The name trimmed, or a plain-words refusal. */
export function requireForumName(kind: ForumKind, name: unknown): string {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new CoreError(`A ${kind} needs a name, and it cannot be blank.`);
  }
  const trimmed = name.trim();
  if ([...trimmed].length > FORUM_NAME_MAX) {
    throw new CoreError(`A ${kind}'s name can be at most ${FORUM_NAME_MAX} characters; this one has ${[...trimmed].length}.`);
  }
  return trimmed;
}

/** Add a topic or a tag on behalf of `tool`. Any member may add one; a name already on the list is refused. */
export async function addForumEntry(store: ForumStore, kind: ForumKind, name: unknown, tool: string): Promise<ForumEntry> {
  const k = requireKind(kind);
  const row: NewForumEntryRow = { tool: requireTool(tool), name: requireForumName(k, name) };
  const existing = await store.findByName(k, row.name);
  if (existing) throw new CoreError(`There is already a ${k} called "${existing.name}".`);
  return store.insert(k, row);
}
