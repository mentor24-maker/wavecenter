import Link from "next/link";
import { signOut } from "./auth/actions";

/**
 * The bar across the top of every page, over Dane's water-drop picture: the
 * gold-and-aqua rings and the WaveCenter name, which always
 * leads home, and on the right either who is signed in with a way out, or a
 * way in. The page passes what it already knows about the visitor, so the
 * header never asks Supabase a second time. A signed-in member also gets a
 * menu: Tasks first (the list, at `/`), then the Game page, where their
 * points are, and their profile. An admin also gets Members
 * (`/members`), where roles are changed; the page says whether the visitor
 * is one.
 * `wide` matches the wider task page, so the bar lines up with the list
 * under it.
 */
export default function SiteHeader({
  email,
  admin = false,
  showSignIn = true,
  wide = false,
}: {
  email?: string | null;
  admin?: boolean;
  showSignIn?: boolean;
  wide?: boolean;
}) {
  return (
    <header className="site">
      <div className={wide ? "site-inner wide" : "site-inner"}>
        <Link href="/" className="brand" aria-label="WaveCenter home">
          {/* Dane's gold-and-aqua rings (public/brand/mark.png); the picture behind the bar is set in globals.css. */}
          <img className="mark" src="/brand/mark.png" alt="" width={54} height={54} />
          <span>
            Wave<b>Center</b>
          </span>
        </Link>
        {email ? (
          <div className="who">
            <Link href="/" className="quiet">Tasks</Link>
            <Link href="/game" className="quiet">Game</Link>
            <Link href="/profile" className="quiet">Profile</Link>
            {admin && <Link href="/members" className="quiet">Members</Link>}
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
