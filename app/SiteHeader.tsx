import Link from "next/link";
import { signOut } from "./auth/actions";
import type { HeaderPoints } from "./lib/engagementStore";
import TokenAnimation from "./TokenAnimation";

/**
 * The bar across the top of every page, over Dane's water-drop picture: the
 * gold-and-aqua rings and the WaveCenter name, which always
 * leads home, and on the right either who is signed in (the name on their
 * profile, or their email until they set one), as a link to their Profile
 * page, with Log out beside it (`Name | Log out`), or the two ways in: Log in and Register. The page passes what it already knows about the visitor, so the
 * header never asks Supabase a second time. A signed-in member also gets a
 * menu: Home first (the dashboard, at `/`), then Proposals (ideas for a
 * change that could become a task, at `/proposals`), then Tasks (the list, at
 * `/tasks`), then the Game page, where their
 * points are, Members (`/members`) and Teams (`/teams`, the
 * Team Manager: the groups members work in). Every member gets Members and Teams; each page itself
 * decides what the member's role may see and do there. An admin also gets
 * Admin (`/admin`); the page says `isAdmin`, from the same rule
 * (core/members.ts `mayOpenAdmin`), and leaves it off when unsure. The menu
 * runs along the bottom of the bar, under the name and Log out.
 * The bar's content is as wide as every page's main body, so the two line up.
 * `points` is the member's point total (app/lib/engagementStore.ts
 * `headerPoints`), shown beside the name as a link to My Points
 * (`Name · 1,234 points | Log out`); a failed read says so, never 0. The
 * total is drawn by TokenAnimation, which floats a spinning disc up to it and
 * counts it up when `playToken` is called.
 * `onPicture` (Home only) drops the bar's own picture and fades its darkening
 * out toward the bottom, so the page's picture behind it shows through unbroken.
 */
export default function SiteHeader({
  name,
  isAdmin = false,
  points,
  showSignIn = true,
  onPicture = false,
}: {
  name?: string | null;
  isAdmin?: boolean;
  points?: HeaderPoints;
  showSignIn?: boolean;
  onPicture?: boolean;
}) {
  return (
    <header className={onPicture ? "site on-picture" : "site"}>
      <div className="site-inner">
        <Link href="/" className="brand" aria-label="WaveCenter home">
          {/* Dane's gold-and-aqua rings (public/brand/mark.png); the picture behind the bar is set in globals.css. */}
          <img className="mark" src="/brand/mark.png" alt="" width={90} height={90} />
          <span>
            Wave<b>Center</b>
          </span>
        </Link>
        {name ? (
          <div className="who">
            <div className="account">
              <Link href="/profile" className="quiet name" title={name}>{name}</Link>
              {points && (
                <>
                  <span className="dot" aria-hidden="true">·</span>
                  <TokenAnimation points={points} />
                </>
              )}
              <span className="sep" aria-hidden="true">|</span>
              <form action={signOut}>
                <button type="submit" className="quiet">Log out</button>
              </form>
            </div>
            <nav className="menu" aria-label="Main menu">
              <Link href="/" className="quiet">Home</Link>
              <Link href="/proposals" className="quiet">Proposals</Link>
              <Link href="/tasks" className="quiet">Tasks</Link>
              <Link href="/game" className="quiet">Game</Link>
              <Link href="/members" className="quiet">Members</Link>
              <Link href="/teams" className="quiet">Teams</Link>
              {isAdmin && <Link href="/admin" className="quiet">Admin</Link>}
            </nav>
          </div>
        ) : (
          showSignIn && (
            <nav className="way-in" aria-label="Log in or register">
              <Link href="/sign-in" className="quiet">Log in</Link>
              <Link href="/register" className="quiet">Register</Link>
            </nav>
          )
        )}
      </div>
    </header>
  );
}
