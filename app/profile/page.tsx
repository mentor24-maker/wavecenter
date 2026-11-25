import Link from "next/link";
import { redirect } from "next/navigation";
import { mayOpenAdmin } from "../../core/members.ts";
import { loadProfile, type MemberProfile } from "../../core/profiles.ts";
import { headerPoints } from "../lib/engagementStore";
import { supabaseMemberProfileStore } from "../lib/memberProfileStore";
import { myRole } from "../lib/memberRoleStore";
import { currentUser, SIGN_IN_CHECK_FAILED, supabaseForRequest } from "../lib/supabase";
import SiteHeader from "../SiteHeader";
import PrivacySummary from "./PrivacySummary";
import ProfileForm from "./ProfileForm";

type Read<T> = { value: T; error: null } | { value: null; error: string };

async function read<T>(load: () => Promise<T>): Promise<Read<T>> {
  try {
    return { value: await load(), error: null };
  } catch (err) {
    return { value: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * "Your profile": the signed-in member's display name, avatar, bio and who
 * may see them (core/profiles.ts). A member who has never saved one sees the
 * anonymous default, and the page says so. Below it, a short note on how
 * WaveCenter treats privacy, shown whatever happens to the profile itself.
 * Messages lived here until WC-234 (Dane's "C") moved them into Comm's
 * Async mode; a line under the form points there. Signed-out visitors are
 * sent to sign in.
 */
export default async function Profile() {
  const supabase = await supabaseForRequest();
  const { user, checkFailed } = supabase ? await currentUser(supabase) : { user: null, checkFailed: false };

  if (!supabase || !user) {
    if (supabase && !checkFailed) redirect("/sign-in");
    return (
      <>
        <SiteHeader />
        <main>
          <h1>Your profile</h1>
          <p className="error" role="alert">
            {!supabase ? "This copy of WaveCenter has no database settings, so there is no profile to show." : SIGN_IN_CHECK_FAILED}
          </p>
        </main>
      </>
    );
  }

  const [role, points] = await Promise.all([read(() => myRole(supabase, user.id)), headerPoints(supabase, user.id)]);
  const isAdmin = role.error === null && mayOpenAdmin(role.value);
  let profile: MemberProfile | null = null;
  let neverSaved = false;
  let readError: string | null = null;
  try {
    const store = supabaseMemberProfileStore(supabase, user.id);
    neverSaved = (await store.get()) === null;
    profile = await loadProfile(store);
  } catch (err) {
    readError = err instanceof Error ? err.message : String(err);
  }

  return (
    <>
      <SiteHeader name={profile?.displayName?.trim() || (user.email ?? "you")} isAdmin={isAdmin} points={points} />
      <main>
        <h1>Your profile</h1>
        <p className="lede">
          Your profile starts completely anonymous. You choose what, if anything, other members can see.{" "}
          <Link href="/privacy">Why WaveCenter puts privacy first</Link>
        </p>
        {readError !== null || !profile ? (
          <p className="error" role="alert">
            Your profile could not be loaded: {readError}. Nothing is shown so nothing wrong is saved over it; try reloading the page.
          </p>
        ) : (
          <>
            {neverSaved && (
              <p className="note" role="status">
                You have not set up a profile yet, so you are <strong>Anonymous</strong>: no name, just an avatar.
              </p>
            )}
            <div className="panel">
              <ProfileForm initial={profile} />
            </div>
          </>
        )}
        <p className="note">Your messages are in <Link href="/comm?mode=async">Comm</Link>, under Async.</p>
        <PrivacySummary />
      </main>
    </>
  );
}
