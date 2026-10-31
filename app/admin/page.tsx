import { redirect } from "next/navigation";
import { mayOpenAdmin, ROLES } from "../../core/members.ts";
import { headerName } from "../lib/memberProfileStore";
import { myRole } from "../lib/memberRoleStore";
import { currentUser, SIGN_IN_CHECK_FAILED, supabaseForRequest } from "../lib/supabase";
import SiteHeader from "../SiteHeader";

/**
 * Admin: the home for admins' tools, which later tasks build. For now the
 * page says so, so it is never a blank area (engineering rule 7). Hiding the
 * menu link does not stop someone typing `/admin`, so the page checks the
 * role itself (core/members.ts `mayOpenAdmin`): another role is told it may
 * not open the Admin area, and a role that could not be read says so.
 * Signed-out visitors are sent to sign in.
 */
export default async function Admin() {
  const supabase = await supabaseForRequest();
  const { user, checkFailed } = supabase ? await currentUser(supabase) : { user: null, checkFailed: false };

  if (!supabase || !user) {
    if (supabase && !checkFailed) redirect("/sign-in");
    return (
      <>
        <SiteHeader />
        <main>
          <h1>Admin</h1>
          <p className="error" role="alert">
            {!supabase ? "This copy of WaveCenter has no database settings, so there is nothing to show." : SIGN_IN_CHECK_FAILED}
          </p>
        </main>
      </>
    );
  }

  const [name, role] = await Promise.all([
    headerName(supabase, user),
    myRole(supabase, user.id).then(
      (value) => ({ value, error: null }),
      (err: unknown) => ({ value: null, error: err instanceof Error ? err.message : String(err) }),
    ),
  ]);
  const isAdmin = role.error === null && mayOpenAdmin(role.value);

  return (
    <>
      <SiteHeader name={name} isAdmin={isAdmin} />
      <main>
        <h1>Admin</h1>
        {role.error !== null ? (
          <p className="error" role="alert">Your role could not be loaded: {role.error}. Try reloading the page.</p>
        ) : !isAdmin ? (
          <p className="note" role="status">
            Your role, <b>{ROLES.find((r) => r.key === role.value)?.name ?? role.value}</b>, may not open the Admin area.
          </p>
        ) : (
          <p className="note">The admin tools are not built yet. They are coming in later tasks.</p>
        )}
      </main>
    </>
  );
}
