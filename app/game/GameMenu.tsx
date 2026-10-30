import Link from "next/link";

/** The Game area's pages, in menu order. */
const PAGES = [
  { key: "points", href: "/game", label: "My Points" },
  { key: "leaderboard", href: "/game/leaderboard", label: "Leaderboard" },
  { key: "manage", href: "/game/manage", label: "Manage" },
] as const;

export type GamePage = (typeof PAGES)[number]["key"];

/**
 * The menu along the top of every Game page, under its heading: My Points
 * (the member's own points, at `/game`), Leaderboard and Manage. The page
 * says which one it is, and that item is marked as the current page.
 */
export default function GameMenu({ current }: { current: GamePage }) {
  return (
    <nav className="game-menu" aria-label="Game">
      {PAGES.map((p) => (
        <Link key={p.key} href={p.href} aria-current={p.key === current ? "page" : undefined}>
          {p.label}
        </Link>
      ))}
    </nav>
  );
}
