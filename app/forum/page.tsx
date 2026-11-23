import Link from "next/link";
import { redirect } from "next/navigation";
import { headerPoints } from "../lib/engagementStore";
import { headerName } from "../lib/memberProfileStore";
import { headerIsAdmin } from "../lib/memberRoleStore";
import { currentUser, SIGN_IN_CHECK_FAILED, supabaseForRequest } from "../lib/supabase";
import SiteHeader from "../SiteHeader";
import { mayChangeTopic } from "../../core/forum.ts";
import { listForumEntries, listTopics } from "../lib/forumStore";
import ForumLists, { type ListEntry } from "./ForumLists";
import { forumNamer } from "./forumNames";
import type { ViewTopic } from "./topicView";

/**
 * The Forum: where members collaboratively curate topics, tags and threads
 * to discuss and exchange ideas, with the aim of producing proposals for the
 * Proposals page (Dane, 2026-11-04). Its first section (WC-178) is Topics
 * on the left and Tags on the right, each a fold-out Add box over a table
 * (ForumLists). Each topic opens on its own page (topics/[id]) and can be
 * changed or deleted by its adder or an admin (WC-183). Threads and the proposal structure come in later sub-tasks.
 * A list that could not be read says so, never a blank area (engineering
 * rule 7). It treats visitors as `/proposals` does: signed out
 * goes to sign in; no database settings or a failed sign-in check is said on
 * the page.
 */
export default async function Forum() {
  const supabase = await supabaseForRequest();
  const { user, checkFailed } = supabase ? await currentUser(supabase) : { user: null, checkFailed: false };

  if (supabase && !user && !checkFailed) redirect("/sign-in");
  if (!supabase || !user) {
    return (
      <>
        <SiteHeader />
        <main>
          <h1>Forum</h1>
          <p className="error" role="alert">
            {!supabase ? "This copy of WaveCenter has no database settings, so there is nothing to show." : SIGN_IN_CHECK_FAILED}
          </p>
        </main>
      </>
    );
  }

  const me = user.id;
  const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
  const [namer, isAdmin] = await Promise.all([forumNamer(supabase, me), headerIsAdmin(supabase, me)]);
  const actor = { memberId: me, isAdmin };

  const [topics, tags, name, points] = await Promise.all([
    listTopics(supabase).then((rows): ViewTopic[] | string => {
      const names = new Map(rows.map((t) => [t.id, t.name]));
      return rows.map((t) => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        description: t.description,
        parentId: t.parentId,
        parentName: (t.parentId && names.get(t.parentId)) || "",
        by: namer(t.createdBy),
        createdAt: t.createdAt,
        mayChange: mayChangeTopic(t, actor),
      }));
    }, message),
    listForumEntries(supabase, "tag").then(
      (rows): ListEntry[] | string => rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.createdAt, by: namer(r.createdBy) })),
      message,
    ),
    headerName(supabase, user),
    headerPoints(supabase, user.id),
  ]);

  return (
    <>
      <SiteHeader name={name} isAdmin={isAdmin} points={points} />
      <main>
        <h1>Forum</h1>
        <p>
          The Forum is where members collaboratively curate topics, tags and threads to discuss and exchange ideas. The
          aim of all the discussion is to produce proposals, which then appear on the{" "}
          <Link href="/proposals">Proposals</Link> page.
        </p>
        <p className="note">
          Topics are what members discuss; tags sort the discussions. Any member can add either one; the member who added a topic, or an admin, can change or delete it. Threads come next.
        </p>
        <ForumLists topics={topics} tags={tags} />
      </main>
    </>
  );
}
