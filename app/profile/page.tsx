import Link from "next/link";
import { redirect } from "next/navigation";
import { loadProfile, type MemberProfile } from "../../core/profiles.ts";
import { supabaseMemberProfileStore } from "../lib/memberProfileStore";
import { currentUser, SIGN_IN_CHECK_FAILED, supabaseForRequest } from "../lib/supabase";
import SiteHeader from "../SiteHeader";
import ProfileForm from "./ProfileForm";

/**
 * "Your profile": the signed-in member's display name, avatar, bio and who
 * may see them (core/profiles.ts). A member who has never saved one sees the
 * anonymous default, and the page says so. Signed-out visitors are sent to
 * sign in.
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
      <SiteHeader email={user.email ?? "you"} />
      <main>
        <h1>Your profile</h1>
        <p className="lede">
          Your profile starts completely anonymous. You choose what, if anything, other members can see.{" "}
          <Link href="https://wavecenter.com/privacy-and-security-first/">Why WaveCenter puts privacy first</Link>
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
      </main>
    </>
  );
}
