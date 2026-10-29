import Link from "next/link";
import { signOut } from "./auth/actions";

/**
 * The bar across the top of every page, over Dane's water-drop picture: the
 * gold-and-aqua rings and the WaveCenter name, which always
 * leads home, and on the right either who is signed in (the name on their
 * profile, or their email until they set one) with Sign out beneath it, or a
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
  name,
  admin = false,
  showSignIn = true,
  wide = false,
}: {
  name?: string | null;
  admin?: boolean;
  showSignIn?: boolean;
  wide?: boolean;
}) {
  return (
    <header className="site">
      <div className={wide ? "site-inner wide" : "site-inner"}>
        <Link href="/" className="brand" aria-label="WaveCenter home">
          {/* Dane's gold-and-aqua rings (public/brand/mark.png); the picture behind the bar is set in globals.css. */}
          <img className="mark" src="/brand/mark.png" alt="" width={36} height={36} />
          <span>
            Wave<b>Center</b>
          </span>
        </Link>
        {name ? (
          <div className="who">
            <Link href="/" className="quiet">Tasks</Link>
            <Link href="/game" className="quiet">Game</Link>
            <Link href="/profile" className="quiet">Profile</Link>
            {admin && <Link href="/members" className="quiet">Members</Link>}
            <div className="account">
              <span className="name" title={name}>{name}</span>
              <form action={signOut}>
                <button type="submit" className="quiet">Sign out</button>
              </form>
            </div>
          </div>
        ) : (
          showSignIn && <Link href="/sign-in" className="quiet">Log in</Link>
        )}
      </div>
    </header>
  );
}
