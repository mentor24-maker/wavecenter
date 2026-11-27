import { signInWithGoogle } from "./actions";

/**
 * The Google button's messages, for the pages it sits on. Fixed text chosen
 * by a code, so nothing typed into the address bar is ever echoed onto the page.
 */
export const GOOGLE_ERRORS: Record<string, string> = {
  "google-off":
    "Google sign-in is not switched on yet. Use your email and password for now.",
  "google-check":
    "WaveCenter could not check whether Google sign-in is switched on. Try again in a minute, or use your email and password.",
  "google-cancelled":
    "The Google sign-in did not finish: it was cancelled at Google. Click Continue with Google to try again.",
  "google-failed":
    "The Google sign-in did not finish. Try again, in the same browser; if it keeps failing, use your email and password.",
};

/**
 * "Continue with Google", on the log-in form (`/sign-in` and the signed-out
 * home page) and on `/register`. `from` names the page it sits on, so a
 * message about it comes back to that same page.
 */
export default function GoogleButton({ from }: { from: "/" | "/sign-in" | "/register" }) {
  return (
    <form action={signInWithGoogle} className="stack panel">
      <input type="hidden" name="from" value={from} />
      <button type="submit">Continue with Google</button>
    </form>
  );
}
