import Link from "next/link";
import { redirect } from "next/navigation";
import { headerPoints } from "../lib/engagementStore";
import { headerName } from "../lib/memberProfileStore";
import { headerIsAdmin } from "../lib/memberRoleStore";
import { currentUser, SIGN_IN_CHECK_FAILED, supabaseForRequest } from "../lib/supabase";
import SiteHeader from "../SiteHeader";

/**
 * The Forum: where members collaboratively curate topics, tags and threads
 * to discuss and exchange ideas, with the aim of producing proposals for the
 * Proposals page (Dane, 2026-11-04). Not built yet: topics, tags, threads and
 * the proposal structure come in later sub-tasks, so for now the page says
 * what the Forum is and that it is not built, never a blank area
 * (engineering rule 7). It treats visitors as `/proposals` does: signed out
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

  const [name, isAdmin, points] = await Promise.all([
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
        <p className="note">The Forum is not built yet. Topics, tags and threads are coming next.</p>
      </main>
    </>
  );
}
