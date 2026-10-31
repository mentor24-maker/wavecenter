import { redirect } from "next/navigation";
import { headerName } from "../lib/memberProfileStore";
import { headerIsAdmin } from "../lib/memberRoleStore";
import { currentUser, SIGN_IN_CHECK_FAILED, supabaseForRequest } from "../lib/supabase";
import SiteHeader from "../SiteHeader";
import GameMenu, { type GamePage } from "./GameMenu";

/**
 * A Game page that is not built yet: the Game heading, the Game menu with
 * this page marked, and one plain sentence saying what is coming, so the
 * page is never a blank area (engineering rule 7). It treats visitors as
 * `/game` does: signed out goes to sign in; no database settings or a failed
 * sign-in check is said on the page.
 */
export default async function GamePlaceholder({ current, message }: { current: GamePage; message: string }) {
  const supabase = await supabaseForRequest();
  const { user, checkFailed } = supabase ? await currentUser(supabase) : { user: null, checkFailed: false };

  if (supabase && !user && !checkFailed) redirect("/sign-in");

  const [name, isAdmin] = supabase && user
    ? await Promise.all([headerName(supabase, user), headerIsAdmin(supabase, user.id)])
    : [null, false];

  return (
    <>
      <SiteHeader name={name} isAdmin={isAdmin} />
      <main>
        <h1>Game</h1>
        <GameMenu current={current} />
        {!supabase ? (
          <p className="error" role="alert">This copy of WaveCenter has no database settings, so there is nothing to show.</p>
        ) : !user ? (
          <p className="error" role="alert">{SIGN_IN_CHECK_FAILED}</p>
        ) : (
          <p className="note">{message}</p>
        )}
      </main>
    </>
  );
}
