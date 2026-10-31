import { redirect } from "next/navigation";
import { headerName } from "../lib/memberProfileStore";
import { currentUser, SIGN_IN_CHECK_FAILED, supabaseForRequest } from "../lib/supabase";
import SiteHeader from "../SiteHeader";

/** The example teams; later tasks add more and let members join them. */
const EXAMPLE_TEAMS = ["UX Design", "Community", "App Pipeline", "Blockchain", "Privacy", "Security", "Infrastructure"];

/**
 * Teams, opened from the top menu: what a Team is and the example teams, so
 * later sub-tasks have a home to build on. Nothing is stored yet. It treats
 * visitors as the Game pages do: signed out goes to sign in; no database
 * settings or a failed sign-in check is said on the page, so it is never a
 * blank area (engineering rule 7).
 */
export default async function Teams() {
  const supabase = await supabaseForRequest();
  const { user, checkFailed } = supabase ? await currentUser(supabase) : { user: null, checkFailed: false };

  if (supabase && !user && !checkFailed) redirect("/sign-in");

  const name = supabase && user ? await headerName(supabase, user) : null;

  return (
    <>
      <SiteHeader name={name} />
      <main>
        <h1>Teams</h1>
        {!supabase ? (
          <p className="error" role="alert">This copy of WaveCenter has no database settings, so there is nothing to show.</p>
        ) : !user ? (
          <p className="error" role="alert">{SIGN_IN_CHECK_FAILED}</p>
        ) : (
          <>
            <p>Teams are groups of members who focus on specific parts of the WaveCenter project. Some example teams:</p>
            <ul>
              {EXAMPLE_TEAMS.map((team) => (
                <li key={team}>{team}</li>
              ))}
            </ul>
            <p className="note">More teams, and what members can do with them, are coming in later tasks.</p>
          </>
        )}
      </main>
    </>
  );
}
