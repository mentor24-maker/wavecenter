import Link from "next/link";
import { redirect } from "next/navigation";
import { headerPoints } from "../lib/engagementStore";
import { headerName } from "../lib/memberProfileStore";
import { headerIsAdmin, listMembers } from "../lib/memberRoleStore";
import { currentUser, SIGN_IN_CHECK_FAILED, supabaseForRequest } from "../lib/supabase";
import SiteHeader from "../SiteHeader";
import type { ForumEntry, ForumKind } from "../../core/forum.ts";
import { listForumEntries } from "../lib/forumStore";
import ForumLists, { type ListEntry } from "./ForumLists";

/**
 * The Forum: where members collaboratively curate topics, tags and threads
 * to discuss and exchange ideas, with the aim of producing proposals for the
 * Proposals page (Dane, 2026-11-04). Its first section (WC-178) is Topics
 * on the left and Tags on the right, each a fold-out Add box over a table
 * (ForumLists). Threads and the proposal structure come in later sub-tasks.
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
  // Display names as the Members page shows them (each member's privacy
  // applied by list_members). If that read fails, the lists still show, with
  // the short id wording.
  const names = listMembers(supabase).then(
    (members) => new Map(members.flatMap((m) => (m.displayName?.trim() ? [[m.memberId, m.displayName.trim()] as const] : []))),
    () => new Map<string, string>(),
  );
  const addedBy = (id: string | null, shown: Map<string, string>) =>
    id === me ? "you" : !id ? "a former member" : shown.get(id) ?? `member ${id.slice(0, 8)}`;
  const read = (kind: ForumKind) =>
    Promise.all([listForumEntries(supabase, kind), names]).then(
      ([rows, shown]): ListEntry[] | string =>
        rows.map((r: ForumEntry) => ({ id: r.id, name: r.name, createdAt: r.createdAt, by: addedBy(r.createdBy, shown) })),
      (err: unknown) => (err instanceof Error ? err.message : String(err)),
    );

  const [topics, tags, name, isAdmin, points] = await Promise.all([
    read("topic"),
    read("tag"),
    headerName(supabase, user),
    headerIsAdmin(supabase, user.id),
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
          Topics are what members discuss; tags sort the discussions. Any member can add either one. Threads come next.
        </p>
        <ForumLists topics={topics} tags={tags} />
      </main>
    </>
  );
}
