import Link from "next/link";
import { mayManageScoring } from "../../core/game.ts";
import { myRole, readRolesAndPermissions } from "../lib/memberRoleStore";
import type { supabaseForRequest } from "../lib/supabase";

type Client = NonNullable<Awaited<ReturnType<typeof supabaseForRequest>>>;

/** The Game area's pages, in menu order. Manage is for admins only. */
const PAGES = [
  { key: "points", href: "/game", label: "My Points" },
  { key: "leaderboard", href: "/game/leaderboard", label: "Leaderboard" },
  { key: "manage", href: "/game/manage", label: "Manage" },
] as const;

export type GamePage = (typeof PAGES)[number]["key"];

/**
 * Whether this member may manage the game scoring ("Manage game scoring",
 * admin only). False when their role or the grants could not be read, so the
 * Manage item never shows on a guess; the database refuses them anyway.
 */
export async function mayManageGame(supabase: Client, memberId: string): Promise<boolean> {
  try {
    const [role, lists] = await Promise.all([myRole(supabase, memberId), readRolesAndPermissions(supabase)]);
    return mayManageScoring({ role, grants: lists.grants });
  } catch {
    return false;
  }
}

/**
 * The menu along the top of every Game page, under its heading: My Points
 * (the member's own points, at `/game`), Leaderboard and, for a member who
 * may manage the scoring, Manage. The page says which one it is, and that
 * item is marked as the current page.
 */
export default function GameMenu({ current, mayManage = false }: { current: GamePage; mayManage?: boolean }) {
  return (
    <nav className="game-menu" aria-label="Game">
      {PAGES.filter((p) => p.key !== "manage" || mayManage).map((p) => (
        <Link key={p.key} href={p.href} aria-current={p.key === current ? "page" : undefined}>
          {p.label}
        </Link>
      ))}
    </nav>
  );
}
