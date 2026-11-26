import Link from "next/link";
import { redirect } from "next/navigation";
import { ANONYMOUS_MEMBER } from "../../../core/leaderboard.ts";
import { isMemberId, shownProfile, type ProfileShown } from "../../../core/profiles.ts";
import { headerPoints } from "../../lib/engagementStore";
import { headerName, readMemberProfile } from "../../lib/memberProfileStore";
import { headerIsAdmin } from "../../lib/memberRoleStore";
import { currentUser, SIGN_IN_CHECK_FAILED, supabaseForRequest } from "../../lib/supabase";
import SiteHeader from "../../SiteHeader";

type Read<T> = { value: T; error: null } | { value: null; error: string };

async function read<T>(load: () => Promise<T>): Promise<Read<T>> {
  try {
    return { value: await load(), error: null };
  } catch (err) {
    return { value: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** What the page says when there is nothing to show; Private and unknown read the same on purpose. */
const NOTHING_TO_SHOW =
  "There is no profile to show here. This member's profile is private, or there is no member at this address.";

/**
 * One member's profile, as another member may see it (WC-238): read only,
 * reached from a name on Game → Leaderboard. What shows is what the
 * database's `member_profile()` lets through (core's `shownProfile` says
 * how): a Public profile's avatar, name and bio; an Anonymous profile's
 * avatar alone, as "Anonymous member"; nothing for a Private profile or an
 * address that names nobody, and the page says why (engineering rule 7).
 * The page never says which of those two it is, so it never confirms that a
 * hidden member exists.
 *
 * Signed out goes to sign in. No database settings, a failed sign-in check
 * and a failed read each say so on the page.
 */
export default async function MemberProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseForRequest();
  const { user, checkFailed } = supabase ? await currentUser(supabase) : { user: null, checkFailed: false };

  if (supabase && !user && !checkFailed) redirect("/sign-in");

  if (!supabase || !user) {
    return (
      <>
        <SiteHeader />
        <main>
          <h1>Member profile</h1>
          <p className="error" role="alert">
            {!supabase ? "This copy of WaveCenter has no database settings, so there is no profile to show." : SIGN_IN_CHECK_FAILED}
          </p>
        </main>
      </>
    );
  }

  const [name, isAdmin, points, profile] = await Promise.all([
    headerName(supabase, user),
    headerIsAdmin(supabase, user.id),
    headerPoints(supabase, user.id),
    // An address that is not a member id names nobody; it is not sent to the database.
    read(async () => (isMemberId(id) ? shownProfile(await readMemberProfile(supabase, id)) : null)),
  ]);
  const own = isMemberId(id) && id.toLowerCase() === user.id.toLowerCase();

  return (
    <>
      <SiteHeader name={name} isAdmin={isAdmin} points={points} />
      <main>
        <h1>Member profile</h1>
        {profile.error !== null ? (
          <p className="error" role="alert">This profile could not be loaded: {profile.error}. Try reloading the page.</p>
        ) : profile.value === null ? (
          <p className="note" role="status">{NOTHING_TO_SHOW}</p>
        ) : (
          <ProfileCard profile={profile.value} />
        )}
        {own && (
          <p className="note">
            This is how other members see you. <Link href="/profile">Change your profile</Link>
          </p>
        )}
        <p>
          <Link href="/game/leaderboard">Back to the leaderboard</Link>
        </p>
      </main>
    </>
  );
}

function ProfileCard({ profile }: { profile: ProfileShown }) {
  return (
    <section className="member-profile" aria-label="Profile">
      <p className="member-profile-name">
        <span className="member-profile-avatar" role="img" aria-label={`${profile.avatarLabel} avatar`}>{profile.avatar}</span>{" "}
        {profile.name ?? <i className="leaderboard-anonymous">{ANONYMOUS_MEMBER}</i>}
      </p>
      {profile.bio ? (
        <p className="member-profile-bio">{profile.bio}</p>
      ) : (
        <p className="note">{profile.name ? "This member has not written a bio." : "This member shows only their avatar."}</p>
      )}
    </section>
  );
}
