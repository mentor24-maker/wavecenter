"use server";

/**
 * Register, log in, reset a password and sign out, run on the server. The
 * browser only submits a form; it never holds a Supabase key.
 */
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseForRequest } from "../lib/supabase";
import {
  looksLikeEmail, newPasswordFailure, passwordProblem, registerFailure, resetFailure, signInFailure,
  type AuthFailure,
} from "./authErrors";

/**
 * The address this request came in on. Links in WaveCenter's emails come back
 * to this same site, whichever copy (preview, production, local) the member
 * is using.
 */
async function origin() {
  const h = await headers();
  return h.get("origin") ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
}

const field = (formData: FormData, name: string) => String(formData.get(name) ?? "");

function logFailure(what: string, e: AuthFailure) {
  console.error(`${what}: ${e.status ?? ""} ${e.code ?? ""} ${e.message ?? ""}`);
}

/**
 * A new visitor registers with an email and a password. Supabase emails them
 * a link to confirm the address; until they open it they cannot log in.
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
    options: { emailRedirectTo: `${await origin()}/auth/confirm` },
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
    redirectTo: `${await origin()}/auth/confirm?next=reset`,
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
