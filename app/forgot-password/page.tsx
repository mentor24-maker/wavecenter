import Link from "next/link";
import { sendPasswordReset } from "../auth/actions";
import SiteHeader from "../SiteHeader";
import { supabaseSettings } from "../lib/supabase";

// Every message is fixed text chosen by a code, so nothing typed into the
// address bar is ever echoed onto the page.
const ERRORS: Record<string, string> = {
  email: "That does not look like an email address. Check it and try again.",
  rate: "Too many emails were sent in a short time. Wait a few minutes, then try again.",
  send: "The reset email could not be sent. Try again in a minute; if it keeps failing, the email service needs a look.",
  setup: "Password reset is not switched on for this copy of WaveCenter yet: its Supabase settings are missing.",
};

/**
 * Ask for an email with a link to set a new password. Members who joined
 * before passwords existed set their first one here.
 */
export default async function ForgotPassword({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { sent, error } = await searchParams;
  const settings = supabaseSettings();
  const missing = "missing" in settings ? settings.missing : [];

  return (
    <>
      <SiteHeader showSignIn={false} />
      <main>
        <h1>Forgot your password?</h1>
        {sent ? (
          <p className="lede">
            If that email has a WaveCenter account, a link to set a new password is on its way. Open it in this browser.
          </p>
        ) : (
          <p className="lede">
            Enter your email and we will send you a link to set a new password. Joined before WaveCenter had
            passwords? This is how you set your first one.
          </p>
        )}
        {error && ERRORS[error] && <p className="error" role="alert">{ERRORS[error]}</p>}
        {missing.length > 0 ? (
          <p className="error" role="alert">
            {ERRORS.setup} Missing: {missing.join(", ")}.
          </p>
        ) : (
          <form action={sendPasswordReset} className="stack panel">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" autoComplete="email" required />
            <button type="submit">{sent ? "Send another link" : "Email me a reset link"}</button>
          </form>
        )}
        <p className="note">
          <Link href="/sign-in">Back to Log in</Link>
        </p>
      </main>
    </>
  );
}
