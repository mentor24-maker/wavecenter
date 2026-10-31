import Link from "next/link";
import { redirect } from "next/navigation";
import { signIn } from "../auth/actions";
import SiteHeader from "../SiteHeader";
import { currentUser, SIGN_IN_CHECK_FAILED, supabaseForRequest, supabaseSettings } from "../lib/supabase";

// Every message is fixed text chosen by a code, so nothing typed into the
// address bar is ever echoed onto the page.
const ERRORS: Record<string, string> = {
  email: "That does not look like an email address. Check it and try again.",
  mismatch: "That email and password do not match. Check them and try again, or reset your password below.",
  unconfirmed: "You have not confirmed your email address yet. Open the link in the email we sent when you registered, then log in.",
  rate: "Too many log-in attempts in a short time. Wait a few minutes, then try again.",
  failed: "Logging in did not work just now. Try again in a minute; if it keeps failing, the log-in service needs a look.",
  expired: "That email link has expired or was already used. Log in below, or ask for a new link with \"Forgot your password?\".",
  link: "That email link did not work. Links only work in the browser you registered or asked for the reset in. If you were confirming your email, it is confirmed: log in below.",
  setup: "Logging in is not switched on for this copy of WaveCenter yet: its Supabase settings are missing.",
};

export default async function SignIn({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { error } = await searchParams;

  const supabase = await supabaseForRequest();
  const { user, checkFailed } = supabase ? await currentUser(supabase) : { user: null, checkFailed: false };
  if (user) redirect("/");
  const settings = supabaseSettings();
  const missing = "missing" in settings ? settings.missing : [];

  return (
    <>
      <SiteHeader showSignIn={false} />
      <main>
        <h1>Log in</h1>
        <p className="lede">Log in with your email and password.</p>
        {error && ERRORS[error] && <p className="error" role="alert">{ERRORS[error]}</p>}
        {checkFailed && <p className="error" role="alert">{SIGN_IN_CHECK_FAILED}</p>}
        {missing.length > 0 ? (
          <p className="error" role="alert">
            {ERRORS.setup} Missing: {missing.join(", ")}.
          </p>
        ) : (
          <form action={signIn} className="stack panel">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" autoComplete="email" required />
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required />
            <button type="submit">Log in</button>
          </form>
        )}
        <p className="note">
          <Link href="/forgot-password">Forgot your password?</Link> Members who joined before passwords
          existed set their first one there.
        </p>
        <p className="note">
          No account yet? <Link href="/register">Register</Link>
        </p>
        <p className="note">
          <Link href="/">Back to WaveCenter</Link>
        </p>
      </main>
    </>
  );
}
