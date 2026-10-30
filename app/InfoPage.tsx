import { headerName } from "./lib/memberProfileStore";
import { currentUser, supabaseForRequest } from "./lib/supabase";
import Mission from "./Mission";
import SiteHeader from "./SiteHeader";

/**
 * A page of words that anyone may read, signed in or not: About WaveCenter
 * and What is a DEO, the two pages Home's callouts open. Until Dane writes
 * their own text, both carry the mission paragraph (his choice, 2026-10-29).
 * A signed-in member sees their name and menu in the header as usual.
 */
export default async function InfoPage({ title }: { title: string }) {
  const supabase = await supabaseForRequest();
  const { user } = supabase ? await currentUser(supabase) : { user: null };
  const name = supabase && user ? await headerName(supabase, user) : null;

  return (
    <>
      <SiteHeader name={name} />
      <main>
        <h1>{title}</h1>
        <Mission />
        <p className="note">More is coming to this page.</p>
      </main>
    </>
  );
}
