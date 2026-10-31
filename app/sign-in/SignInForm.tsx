import { sendMagicLink } from "../auth/actions";
import { SIGN_IN_CHECK_FAILED, supabaseSettings } from "../lib/supabase";

// Every message is fixed text chosen by a code, so nothing typed into the
// address bar is ever echoed onto the page.
const ERRORS: Record<string, string> = {
  email: "That does not look like an email address. Check it and try again.",
  send: "The log-in email could not be sent. Try again in a minute; if it keeps failing, the email service needs a look.",
  rate: "Too many log-in emails were sent in a short time. Wait a few minutes, then try again.",
  expired: "That log-in link has expired or was already used. Enter your email to get a fresh one.",
  link: "That log-in link did not work. Links only work in the browser that asked for them, so request a new one here and open it in this browser.",
  setup: "Logging in is not switched on for this copy of WaveCenter yet: its Supabase settings are missing.",
};

/**
 * The one log-in form, with its messages, shown on `/sign-in` and on the
 * signed-out home page. WaveCenter has no passwords: the emailed link logs a
 * member in, and the same link is how a new member joins. `from` names the
 * page the form sits on, so the "check your email" and error messages come
 * back to that same page (the action only accepts the pages it knows).
 */
export default function SignInForm({
  from,
  sent,
  error,
  checkFailed,
}: {
  from: "/" | "/sign-in";
  sent?: string;
  error?: string;
  checkFailed: boolean;
}) {
  const settings = supabaseSettings();
  const missing = "missing" in settings ? settings.missing : [];

  return (
    <>
      {sent ? (
        <p className="lede">Check your email. We sent you a log-in link; open it in this browser.</p>
      ) : (
        <p className="lede">Enter your email and we will send you a link that logs you in. No password.</p>
      )}
      {error && ERRORS[error] && <p className="error" role="alert">{ERRORS[error]}</p>}
      {checkFailed && <p className="error" role="alert">{SIGN_IN_CHECK_FAILED}</p>}
      {missing.length > 0 ? (
        <p className="error" role="alert">
          {ERRORS.setup} Missing: {missing.join(", ")}.
        </p>
      ) : (
        <form action={sendMagicLink} className="stack panel">
          <input type="hidden" name="from" value={from} />
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required />
          <button type="submit">{sent ? "Send another link" : "Email me a log-in link"}</button>
        </form>
      )}
    </>
  );
}
