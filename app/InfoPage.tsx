import type { ReactNode } from "react";
import { headerName } from "./lib/memberProfileStore";
import { currentUser, supabaseForRequest } from "./lib/supabase";
import Mission from "./Mission";
import SiteHeader from "./SiteHeader";

/**
 * A page of words that anyone may read, signed in or not: About WaveCenter
 * and What is a DEO, the two pages Home's callouts open. A page that passes
 * its own content (What is a DEO, a summary of the whitepaper) shows that;
 * one that does not (About WaveCenter, until Dane writes its text) carries
 * the mission paragraph (his choice, 2026-10-29). A signed-in member sees
 * their name and menu in the header as usual.
 */
export default async function InfoPage({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  const supabase = await supabaseForRequest();
  const { user } = supabase ? await currentUser(supabase) : { user: null };
  const name = supabase && user ? await headerName(supabase, user) : null;

  return (
    <>
      <SiteHeader name={name} />
      <main>
        <h1>{title}</h1>
        {children ?? (
          <>
            <Mission />
            <p className="note">More is coming to this page.</p>
          </>
        )}
      </main>
    </>
  );
}
