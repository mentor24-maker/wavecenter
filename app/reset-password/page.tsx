import Link from "next/link";
import { setNewPassword } from "../auth/actions";
import { MIN_PASSWORD_LENGTH } from "../auth/authErrors";
import { headerName } from "../lib/memberProfileStore";
import SiteHeader from "../SiteHeader";
import { currentUser, SIGN_IN_CHECK_FAILED, supabaseForRequest } from "../lib/supabase";

// Every message is fixed text chosen by a code, so nothing typed into the
// address bar is ever echoed onto the page.
const ERRORS: Record<string, string> = {
  short: `That password is too short. Use at least ${MIN_PASSWORD_LENGTH} characters.`,
  mismatch: "The two passwords do not match. Type the same password in both boxes.",
  same: "That is already your password. Choose a different one.",
  expired: "Your reset link has run out. Ask for a new one and open it straight away.",
  failed: "Your new password was not saved. Try again in a minute; if it keeps failing, the log-in service needs a look.",
  setup: "Password reset is not switched on for this copy of WaveCenter yet: its Supabase settings are missing.",
};

/**
 * Where the link in a reset email lands, once /auth/confirm has signed the
 * member in: they choose a new password. A signed-in member can also change
 * theirs here.
 */
export default async function ResetPassword({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { saved, error } = await searchParams;

  const supabase = await supabaseForRequest();
  const { user, checkFailed } = supabase ? await currentUser(supabase) : { user: null, checkFailed: false };
  const name = supabase && user ? await headerName(supabase, user) : null;

  return (
    <>
      <SiteHeader name={name} />
      <main>
        <h1>Set a new password</h1>
        {error && ERRORS[error] && <p className="error" role="alert">{ERRORS[error]}</p>}
        {checkFailed && <p className="error" role="alert">{SIGN_IN_CHECK_FAILED}</p>}
        {!supabase ? (
          <p className="error" role="alert">{ERRORS.setup}</p>
        ) : saved && user ? (
          <>
            <p className="lede">Your new password is saved, and you are signed in.</p>
            <p>
              <Link href="/" className="button">Go to WaveCenter</Link>
            </p>
          </>
        ) : user ? (
          <form action={setNewPassword} className="stack panel">
            <label htmlFor="password">New password (at least {MIN_PASSWORD_LENGTH} characters)</label>
            <input id="password" name="password" type="password" autoComplete="new-password" required />
            <label htmlFor="confirm">Confirm new password</label>
            <input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
            <button type="submit">Save new password</button>
          </form>
        ) : (
          !checkFailed && (
            <p className="lede">
              This page needs the link from your reset email, and that link has not signed you in. Ask for a new
              one on <Link href="/forgot-password">Forgot your password?</Link> and open it in this browser.
            </p>
          )
        )}
      </main>
    </>
  );
}
