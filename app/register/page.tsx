import Link from "next/link";
import { redirect } from "next/navigation";
import { register } from "../auth/actions";
import { MIN_PASSWORD_LENGTH } from "../auth/authErrors";
import SiteHeader from "../SiteHeader";
import { currentUser, SIGN_IN_CHECK_FAILED, supabaseForRequest, supabaseSettings } from "../lib/supabase";

// Every message is fixed text chosen by a code, so nothing typed into the
// address bar is ever echoed onto the page.
const ERRORS: Record<string, string> = {
  email: "That does not look like an email address. Check it and try again.",
  short: `That password is too short. Use at least ${MIN_PASSWORD_LENGTH} characters.`,
  mismatch: "The two passwords do not match. Type the same password in both boxes.",
  taken: "That email is already registered. Log in instead, or use \"Forgot your password?\" to set a new one.",
  rate: "Too many emails were sent in a short time. Wait a few minutes, then try again.",
  send: "Your account could not be created, or the confirmation email could not be sent. Try again in a minute; if it keeps failing, the email service needs a look.",
  setup: "Registering is not switched on for this copy of WaveCenter yet: its Supabase settings are missing.",
};

/**
 * A new visitor registers with an email and a password, then confirms the
 * address from the email Supabase sends.
 */
export default async function Register({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { sent, error } = await searchParams;

  const supabase = await supabaseForRequest();
  const { user, checkFailed } = supabase ? await currentUser(supabase) : { user: null, checkFailed: false };
  if (user) redirect("/");
  const settings = supabaseSettings();
  const missing = "missing" in settings ? settings.missing : [];

  return (
    <>
      <SiteHeader showSignIn={false} />
      <main>
        <h1>Register</h1>
        {sent ? (
          <p className="lede">
            Check your email to confirm your address. Open the link in this browser; it signs you in to WaveCenter.
          </p>
        ) : (
          <p className="lede">Create your WaveCenter account with your email and a password.</p>
        )}
        {error && ERRORS[error] && <p className="error" role="alert">{ERRORS[error]}</p>}
        {checkFailed && <p className="error" role="alert">{SIGN_IN_CHECK_FAILED}</p>}
        {missing.length > 0 ? (
          <p className="error" role="alert">
            {ERRORS.setup} Missing: {missing.join(", ")}.
          </p>
        ) : (
          !sent && (
            <form action={register} className="stack panel">
              <label htmlFor="email">Email</label>
              <input id="email" name="email" type="email" autoComplete="email" required />
              <label htmlFor="password">Password (at least {MIN_PASSWORD_LENGTH} characters)</label>
              <input id="password" name="password" type="password" autoComplete="new-password" required />
              <label htmlFor="confirm">Confirm password</label>
              <input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
              <button type="submit">Register</button>
            </form>
          )
        )}
        <p className="note">
          Already registered? <Link href="/sign-in">Log in</Link>
        </p>
        <p className="note">
          <Link href="/">Back to WaveCenter</Link>
        </p>
      </main>
    </>
  );
}
