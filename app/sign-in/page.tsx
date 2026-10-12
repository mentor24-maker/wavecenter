import Link from "next/link";
import { redirect } from "next/navigation";
import { sendMagicLink } from "../auth/actions";
import { currentUser, SIGN_IN_CHECK_FAILED, supabaseForRequest, supabaseSettings } from "../lib/supabase";

// Every message is fixed text chosen by a code, so nothing typed into the
// address bar is ever echoed onto the page.
const ERRORS: Record<string, string> = {
  email: "That does not look like an email address. Check it and try again.",
  send: "The sign-in email could not be sent. Try again in a minute; if it keeps failing, the email service needs a look.",
  rate: "Too many sign-in emails were sent in a short time. Wait a few minutes, then try again.",
  expired: "That sign-in link has expired or was already used. Enter your email to get a fresh one.",
  link: "That sign-in link did not work. Links only work in the browser that asked for them, so request a new one here and open it in this browser.",
  setup: "Sign-in is not switched on for this copy of WaveCenter yet: its Supabase settings are missing.",
};

export default async function SignIn({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { sent, error } = await searchParams;

  const supabase = await supabaseForRequest();
  const { user, checkFailed } = supabase ? await currentUser(supabase) : { user: null, checkFailed: false };
  if (user) redirect("/");
  const settings = supabaseSettings();
  const missing = "missing" in settings ? settings.missing : [];

  return (
    <main>
      <h1>Sign in</h1>
      {sent ? (
        <p className="lede">Check your email. We sent you a sign-in link; open it in this browser.</p>
      ) : (
        <p className="lede">Enter your email and we will send you a link that signs you in. No password.</p>
      )}
      {error && ERRORS[error] && <p className="error" role="alert">{ERRORS[error]}</p>}
      {checkFailed && <p className="error" role="alert">{SIGN_IN_CHECK_FAILED}</p>}
      {missing.length > 0 ? (
        <p className="error" role="alert">
          {ERRORS.setup} Missing: {missing.join(", ")}.
        </p>
      ) : (
        <form action={sendMagicLink} className="stack">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required />
          <button type="submit">{sent ? "Send another link" : "Email me a sign-in link"}</button>
        </form>
      )}
      <p className="note">
        <Link href="/">Back to WaveCenter</Link>
      </p>
    </main>
  );
}
