/**
 * The Game leaderboard (Dane, 2026-11-25, WaveCenter task "Create
 * Leaderboard"): every member, ranked by points, with four scores.
 *
 * - **Granular**: the member's engagement-ledger total, the small automatic
 *   points for each action (core/game.ts). The same number My Points shows.
 * - **Globular**: the points on the member's finished tasks
 *   (`scoreFinishedTasks` in core/score.ts). Task points roll up here.
 * - **Tasks**: how many tasks the member has finished. A count, not points.
 * - **Total**: Granular + Globular. The board is ranked by it.
 *
 * The rows come from the database's `leaderboard()` function, which has
 * already left out what a member's profile may not show (the same rule as
 * the Members page and Evolution cards): the name of a profile that is not
 * Public, and the avatar of a Private one. Who is shown how is core's
 * `cardCredit`, the placeholder for the permissions settings to come, so the
 * leaderboard follows them when they arrive. A shown name links to the
 * member's profile page (WC-238); every other row is plain text, and the
 * database sends no id for it.
 */
import { cardCredit, isMemberId, type MemberProfile } from './profiles.ts';

/** One member's row as the database gives it. */
export interface LeaderboardEntry {
  /** Whether this row is the member looking at the board. */
  you: boolean;
  /** The avatar id, or null when the profile is Private. */
  avatar: string | null;
  /** The name, or null unless the profile is Public and has one. */
  displayName: string | null;
  granular: number;
  globular: number;
  /** How many tasks the member has finished. */
  tasks: number;
  /**
   * The member's id, the link to their profile page. The database sends it
   * only for a Public member with a name; null for everyone else.
   */
  memberId?: string | null;
}

/** One row of the board, ranked and ready to show. */
export interface LeaderboardRow extends LeaderboardEntry {
  /** 1 for the top; members with the same Total share a rank. */
  rank: number;
  /** Granular + Globular. */
  total: number;
  /** The avatar's symbol to show, e.g. "🌊"; the neutral 👤 for a Private profile. */
  avatarSymbol: string;
  /** The avatar's name, for a screen reader. */
  avatarLabel: string;
  /** The name to show: the Public name, or "Anonymous member". */
  name: string;
  /** Whether the name is the member's own Public one (false for "Anonymous member"). */
  named: boolean;
  /** Where the name links: the member's profile page, or null for no link (WC-238). */
  profileHref: string | null;
}

/** The address of a member's profile page. */
export function profileHref(memberId: string): string {
  return `/members/${encodeURIComponent(memberId)}`;
}

/** What a member whose name may not be shown appears as. */
export const ANONYMOUS_MEMBER = 'Anonymous member';

const NEUTRAL = { symbol: '👤', label: 'Member' };

/** A whole, non-negative number of points; anything else counts as 0. */
function points(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * Rank `entries` by Total, highest first. Members with the same Total share a
 * rank and the next rank skips past them (1, 2, 2, 4). Among a tie, named
 * members come first in name order, then anonymous ones in the order given,
 * so the order never depends on anything the board does not show.
 */
export function rankLeaderboard(entries: readonly LeaderboardEntry[]): LeaderboardRow[] {
  const rows = entries.map((entry, index) => {
    const granular = points(entry.granular);
    const globular = points(entry.globular);
    const visibility: MemberProfile['visibility'] = entry.avatar == null ? 'private' : entry.displayName?.trim() ? 'public' : 'anonymous';
    const shown = cardCredit({ displayName: entry.displayName, avatar: (entry.avatar ?? 'wave') as MemberProfile['avatar'], visibility });
    return {
      index,
      row: {
        ...entry,
        granular,
        globular,
        tasks: points(entry.tasks),
        total: granular + globular,
        rank: 0,
        avatarSymbol: shown.avatar ?? NEUTRAL.symbol,
        avatarLabel: shown.avatarLabel ?? NEUTRAL.label,
        name: shown.name ?? ANONYMOUS_MEMBER,
        named: shown.name != null,
        profileHref: shown.profileLink && isMemberId(entry.memberId) ? profileHref(entry.memberId) : null,
      },
    };
  });

  rows.sort((x, y) => {
    if (y.row.total !== x.row.total) return y.row.total - x.row.total;
    if (x.row.named !== y.row.named) return x.row.named ? -1 : 1;
    if (x.row.named) {
      const byName = x.row.name.localeCompare(y.row.name, 'en', { sensitivity: 'base' });
      if (byName !== 0) return byName;
    }
    return x.index - y.index;
  });

  let rank = 0;
  return rows.map(({ row }, i) => {
    if (i === 0 || row.total !== rows[i - 1].row.total) rank = i + 1;
    return { ...row, rank };
  });
}
