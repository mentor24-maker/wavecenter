"use server";

/**
 * Register, log in (email and password, or Google), reset a password and
 * sign out, run on the server. The browser only submits a form; it never
 * holds a Supabase key.
 */
import { redirect } from "next/navigation";
import { newAccountData } from "../../core/accounts.ts";
import { WAVECENTER_TOOL } from "../../core/tool.ts";
import { requestOrigin } from "../lib/requestOrigin";
import { supabaseForRequest, supabaseSettings } from "../lib/supabase";
import {
  googleButtonPage, googleSwitchedOn, looksLikeEmail, newPasswordFailure, passwordProblem, registerFailure, resetFailure, signInFailure,
  type AuthFailure,
} from "./authErrors";

const field = (formData: FormData, name: string) => String(formData.get(name) ?? "");

function logFailure(what: string, e: AuthFailure) {
  console.error(`${what}: ${e.status ?? ""} ${e.code ?? ""} ${e.message ?? ""}`);
}

/**
 * A new visitor registers with an email and a password. Supabase emails them
 * a link to confirm the address; until they open it they cannot log in.
 * Making the account earns the new member their first point
 * (`joined_wavecenter`): the database records it in the same save, naming
 * the tool in the account's metadata.
 */
export async function register(formData: FormData) {
  const email = field(formData, "email").trim();
  const password = field(formData, "password");
  if (!looksLikeEmail(email)) redirect("/register?error=email");
  const problem = passwordProblem(password, field(formData, "confirm"));
  if (problem) redirect(`/register?error=${problem}`);

  const supabase = await supabaseForRequest();
  if (!supabase) redirect("/register?error=setup");

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${await requestOrigin()}/auth/confirm`, data: newAccountData(WAVECENTER_TOOL) },
  });
  if (error) {
    logFailure("register", error);
    redirect(`/register?error=${registerFailure(error)}`);
  }
  // With "Confirm email" on, Supabase answers an email that is already
  // registered with a stand-in account that has no identities, and sends
  // nothing. Say so, or the visitor waits for an email that never comes.
  if (data.user && data.user.identities?.length === 0) redirect("/register?error=taken");
  // With "Confirm email" off, the account is signed in straight away.
  if (data.session) redirect("/");
  redirect("/register?sent=1");
}

/**
 * The pages the log-in form sits on. Its messages go back to the page that
 * sent it; anything else falls back to `/sign-in`, so the form can never be
 * used to send a visitor to some other address.
 */
const FORM_PAGES = ["/", "/sign-in"];

/** A member logs in with their email and password. */
export async function signIn(formData: FormData) {
  const from = field(formData, "from");
  const back = FORM_PAGES.includes(from) ? from : "/sign-in";

  const email = field(formData, "email").trim();
  const password = field(formData, "password");
  if (!looksLikeEmail(email)) redirect(`${back}?error=email`);
  if (!password) redirect(`${back}?error=mismatch`);

  const supabase = await supabaseForRequest();
  if (!supabase) redirect(`${back}?error=setup`);

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    logFailure("log in", error);
    redirect(`${back}?error=${signInFailure(error)}`);
  }
  redirect("/");
}

/**
 * Is Google sign-in switched on in this copy's Supabase? Asked of Supabase's
 * public settings address with the public anon key, on the server. Until Dane
 * switches the provider on (docs/GOOGLE_SIGN_IN_SETUP.md), Supabase would
 * answer the Google button with a raw error page, so the button says so
 * itself instead.
 */
async function googleIsOn(): Promise<"on" | "off" | "unknown"> {
  const settings = supabaseSettings();
  if ("missing" in settings) return "unknown";
  try {
    const res = await fetch(`${settings.url}/auth/v1/settings`, {
      headers: { apikey: settings.anonKey },
      cache: "no-store",
    });
    if (!res.ok) {
      console.error(`Google sign-in check: Supabase settings answered HTTP ${res.status}`);
      return "unknown";
    }
    return googleSwitchedOn(await res.json());
  } catch (e) {
    console.error(`Google sign-in check: ${(e as Error).message}`);
    return "unknown";
  }
}

/**
 * "Continue with Google": the same button logs in a member and registers a
 * new one. Supabase hands back Google's address with a one-time code
 * challenge (its cookie is set here), the browser goes to Google, and Google
 * sends it back through Supabase to /auth/callback, which signs the member
 * in. A first Google sign-in makes the account, and the database records its
 * `joined_wavecenter` point in that same save, as for email registering.
 */
export async function signInWithGoogle(formData: FormData) {
  const back = googleButtonPage(field(formData, "from"));

  const supabase = await supabaseForRequest();
  if (!supabase) redirect(`${back}?error=setup`);

  const on = await googleIsOn();
  if (on === "off") redirect(`${back}?error=google-off`);
  if (on === "unknown") redirect(`${back}?error=google-check`);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${await requestOrigin()}/auth/callback` },
  });
  if (error || !data.url) {
    if (error) logFailure("Google sign-in", error);
    redirect(`${back}?error=google-failed`);
  }
  redirect(data.url);
}

/**
 * Email a link for setting a new password. Members who joined before
 * passwords existed set their first one this way.
 */
export async function sendPasswordReset(formData: FormData) {
  const email = field(formData, "email").trim();
  if (!looksLikeEmail(email)) redirect("/forgot-password?error=email");

  const supabase = await supabaseForRequest();
  if (!supabase) redirect("/forgot-password?error=setup");

  // `next=reset` tells /auth/confirm to go on to the set-a-new-password page.
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${await requestOrigin()}/auth/confirm?next=reset`,
  });
  if (error) {
    logFailure("password reset email", error);
    redirect(`/forgot-password?error=${resetFailure(error)}`);
  }
  redirect("/forgot-password?sent=1");
}

/** The member, signed in by their reset link, saves a new password. */
export async function setNewPassword(formData: FormData) {
  const password = field(formData, "password");
  const problem = passwordProblem(password, field(formData, "confirm"));
  if (problem) redirect(`/reset-password?error=${problem}`);

  const supabase = await supabaseForRequest();
  if (!supabase) redirect("/reset-password?error=setup");

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    logFailure("set new password", error);
    redirect(`/reset-password?error=${newPasswordFailure(error)}`);
  }
  redirect("/reset-password?saved=1");
}

export async function signOut() {
  const supabase = await supabaseForRequest();
  if (supabase) {
    const { error } = await supabase.auth.signOut();
    if (error) console.error(`sign-out: ${error.message}`);
  }
  redirect("/");
}
