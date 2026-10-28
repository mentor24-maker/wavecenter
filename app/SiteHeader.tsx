import Link from "next/link";
import { signOut } from "./auth/actions";

/**
 * The bar across the top of every page: the WaveCenter name, which always
 * leads home, and on the right either who is signed in with a way out, or a
 * way in. The page passes what it already knows about the visitor, so the
 * header never asks Supabase a second time. A signed-in member also gets a
 * link to the Game page, where their points are.
 */
export default function SiteHeader({ email, showSignIn = true }: { email?: string | null; showSignIn?: boolean }) {
  return (
    <header className="site">
      <div className="site-inner">
        <Link href="/" className="brand" aria-label="WaveCenter home">
          {/* The same file as the browser-tab icon: Next.js serves app/icon.png at /icon.png. */}
          <img className="mark" src="/icon.png" alt="" width={28} height={28} />
          <span>
            Wave<b>Center</b>
          </span>
        </Link>
        {email ? (
          <div className="who">
            <Link href="/game" className="quiet">Game</Link>
            <span className="email" title={email}>{email}</span>
            <form action={signOut}>
              <button type="submit" className="quiet">Sign out</button>
            </form>
          </div>
        ) : (
          showSignIn && <Link href="/sign-in" className="quiet">Sign in</Link>
        )}
      </div>
    </header>
  );
}
