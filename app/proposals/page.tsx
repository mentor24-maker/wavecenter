import { redirect } from "next/navigation";
import type { Proposal } from "../../core/proposals.ts";
import { headerName } from "../lib/memberProfileStore";
import { headerIsAdmin } from "../lib/memberRoleStore";
import { listProposals } from "../lib/proposalStore";
import { currentUser, SIGN_IN_CHECK_FAILED, supabaseForRequest } from "../lib/supabase";
import SiteHeader from "../SiteHeader";
import ProposalList from "./ProposalList";

/**
 * Proposals: ideas for a change that could become a task, if they pass
 * muster (Dane, 2026-11-02). Every member's proposals, read through the
 * member's own session; a member adds proposals and changes and deletes only
 * their own. To start, a proposal looks just like a task; later steps of the
 * series reshape it. A visitor who is not signed in is sent to sign in.
 * Every empty or failed state says why (engineering rule 7).
 */
export default async function Proposals() {
  const supabase = await supabaseForRequest();
  const { user, checkFailed } = supabase ? await currentUser(supabase) : { user: null, checkFailed: false };

  // Signed out, with nothing gone wrong: go and sign in. A missing database
  // or a failed sign-in check is said on this page instead, not hidden by a bounce.
  if (supabase && !user && !checkFailed) redirect("/sign-in");
  if (!supabase || !user) {
    return (
      <>
        <SiteHeader />
        <main>
          <h1>Proposals</h1>
          <p className="error" role="alert">
            {!supabase ? "This copy of WaveCenter has no database settings, so there are no proposals to show." : SIGN_IN_CHECK_FAILED}
          </p>
        </main>
      </>
    );
  }

  const [proposals, name, isAdmin] = await Promise.all([
    listProposals(supabase).then(
      (value): { value: Proposal[]; error: null } => ({ value, error: null }),
      (err: unknown) => ({ value: null, error: err instanceof Error ? err.message : String(err) }),
    ),
    headerName(supabase, user),
    headerIsAdmin(supabase, user.id),
  ]);

  return (
    <>
      <SiteHeader name={name} isAdmin={isAdmin} />
      <main>
        <h1>Proposals</h1>
        <p className="note">
          A proposal is an idea for a change that could become a task. Here is every member&rsquo;s; you can add your own,
          and change or delete the ones you made.
        </p>
        {proposals.error !== null ? (
          <p className="error" role="alert">
            The proposals could not be loaded: {proposals.error}. Nothing has been lost; try reloading the page.
          </p>
        ) : (
          <ProposalList
            proposals={proposals.value.map((p) => ({
              id: p.id,
              title: p.title,
              notes: p.notes,
              status: p.status,
              points: p.points,
              priority: p.priority,
              createdAt: p.createdAt,
              mine: p.ownerId === user.id,
              owner: p.ownerId === user.id ? "you" : `member ${p.ownerId.slice(0, 8)}`,
            }))}
          />
        )}
      </main>
    </>
  );
}
