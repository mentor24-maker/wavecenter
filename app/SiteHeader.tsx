import Link from "next/link";
import { signOut } from "./auth/actions";

/**
 * The bar across the top of every page: the WaveCenter name, which always
 * leads home, and on the right either who is signed in with a way out, or a
 * way in. The page passes what it already knows about the visitor, so the
 * header never asks Supabase a second time.
 */
export default function SiteHeader({ email, showSignIn = true }: { email?: string | null; showSignIn?: boolean }) {
  return (
    <header className="site">
      <div className="site-inner">
        <Link href="/" className="brand" aria-label="WaveCenter home">
          <svg className="mark" viewBox="0 0 32 32" aria-hidden="true">
            <circle cx="16" cy="16" r="15" />
            <path d="M5 18c3.5-5 7-5 11 0s7.5 5 11 0" />
          </svg>
          <span>
            Wave<b>Center</b>
          </span>
        </Link>
        {email ? (
          <div className="who">
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
