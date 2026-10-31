import Link from "next/link";
import { signOut } from "./auth/actions";

/**
 * The bar across the top of every page, over Dane's water-drop picture: the
 * gold-and-aqua rings and the WaveCenter name, which always
 * leads home, and on the right either who is signed in (the name on their
 * profile, or their email until they set one) with Sign out beneath it, or a
 * way in. The page passes what it already knows about the visitor, so the
 * header never asks Supabase a second time. A signed-in member also gets a
 * menu: Home first (the dashboard, at `/`), then Tasks (the list, at
 * `/tasks`), then the Game page, where their
 * points are, their profile, and Members (`/members`). Every member gets
 * Members; the page itself decides what a non-admin may see there. An admin
 * also gets Admin (`/admin`); the page says `isAdmin`, from the same rule
 * (core/members.ts `mayOpenAdmin`), and leaves it off when unsure. The menu
 * runs along the bottom of the bar, under the name and Sign out.
 * The bar's content is as wide as every page's main body, so the two line up.
 */
export default function SiteHeader({
  name,
  isAdmin = false,
  showSignIn = true,
}: {
  name?: string | null;
  isAdmin?: boolean;
  showSignIn?: boolean;
}) {
  return (
    <header className="site">
      <div className="site-inner">
        <Link href="/" className="brand" aria-label="WaveCenter home">
          {/* Dane's gold-and-aqua rings (public/brand/mark.png); the picture behind the bar is set in globals.css. */}
          <img className="mark" src="/brand/mark.png" alt="" width={54} height={54} />
          <span>
            Wave<b>Center</b>
          </span>
        </Link>
        {name ? (
          <div className="who">
            <div className="account">
              <span className="name" title={name}>{name}</span>
              <form action={signOut}>
                <button type="submit" className="quiet">Sign out</button>
              </form>
            </div>
            <nav className="menu" aria-label="Main menu">
              <Link href="/" className="quiet">Home</Link>
              <Link href="/tasks" className="quiet">Tasks</Link>
              <Link href="/game" className="quiet">Game</Link>
              <Link href="/profile" className="quiet">Profile</Link>
              <Link href="/members" className="quiet">Members</Link>
              {isAdmin && <Link href="/admin" className="quiet">Admin</Link>}
            </nav>
          </div>
        ) : (
          showSignIn && <Link href="/sign-in" className="quiet">Log in</Link>
        )}
      </div>
    </header>
  );
}
