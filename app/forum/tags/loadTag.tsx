/**
 * What a tag's own page and its edit page both need (WC-186): the signed-in
 * member, the header, every tag (for the related tags' names and the tick
 * boxes) and the one asked for. Read through the member's own session, so
 * row-level security decides what comes back. Every way it can fail comes
 * back as a plain-words reason for the page to show, never an empty screen
 * (rule 7). The page around it is the topic pages' own (TopicShell).
 */
import { redirect } from "next/navigation";
import { mayChangeTag, type ForumTag } from "../../../core/forum.ts";
import { headerPoints } from "../../lib/engagementStore";
import { listTags } from "../../lib/forumStore";
import { headerName } from "../../lib/memberProfileStore";
import { headerIsAdmin } from "../../lib/memberRoleStore";
import { currentUser, SIGN_IN_CHECK_FAILED, supabaseForRequest } from "../../lib/supabase";
import { forumNamer } from "../forumNames";
import type { Header } from "../topics/loadTopic";

export { TopicShell as TagShell } from "../topics/loadTopic";

/** A tag id is a UUID; anything else cannot be a tag, so it is not asked for. */
const TAG_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TagLoad =
  | { ok: false; header: Header; problem: string }
  | { ok: true; header: Header; tag: ForumTag; tags: ForumTag[]; mayChange: boolean; namer: (id: string | null) => string };

export async function loadTag(id: string): Promise<TagLoad> {
  const supabase = await supabaseForRequest();
  const { user, checkFailed } = supabase ? await currentUser(supabase) : { user: null, checkFailed: false };
  if (supabase && !user && !checkFailed) redirect("/sign-in");
  if (!supabase || !user) {
    return {
      ok: false,
      header: {},
      problem: !supabase ? "This copy of WaveCenter has no database settings, so there is no tag to show." : SIGN_IN_CHECK_FAILED,
    };
  }

  const [name, isAdmin, points, namer, read] = await Promise.all([
    headerName(supabase, user),
    headerIsAdmin(supabase, user.id),
    headerPoints(supabase, user.id),
    forumNamer(supabase, user.id),
    listTags(supabase).then(
      (tags) => ({ tags }),
      (err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }),
    ),
  ]);
  const header = { name, isAdmin, points };
  if ("error" in read) return { ok: false, header, problem: `This tag could not be loaded: ${read.error}. Nothing has been lost; try reloading the page.` };
  const tag = TAG_ID.test(id) ? read.tags.find((t) => t.id === id) : undefined;
  if (!tag) return { ok: false, header, problem: "This tag was not found. It may have been deleted, or the link may be wrong." };
  return { ok: true, header, tag, tags: read.tags, mayChange: mayChangeTag(tag, { memberId: user.id, isAdmin }), namer };
}

/** The tags `tag` is related to, A to Z, as id and name. */
export function relatedOf(tag: ForumTag, tags: readonly ForumTag[]): { id: string; name: string }[] {
  return tags
    .filter((t) => tag.relatedIds.includes(t.id))
    .map((t) => ({ id: t.id, name: t.name }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
}
