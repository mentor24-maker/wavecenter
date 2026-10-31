"use server";

/**
 * Sign-in and sign-out, run on the server. The browser only submits a form;
 * it never holds a Supabase key.
 */
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseForRequest } from "../lib/supabase";

/**
 * The pages the log-in form sits on. Its messages go back to the page that
 * sent it; anything else falls back to `/sign-in`, so the form can never be
 * used to send a visitor to some other address.
 */
const FORM_PAGES = ["/", "/sign-in"];

/** Email the member a one-time sign-in link (a "magic link"). */
export async function sendMagicLink(formData: FormData) {
  const from = String(formData.get("from") ?? "");
  const back = FORM_PAGES.includes(from) ? from : "/sign-in";

  const email = String(formData.get("email") ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) redirect(`${back}?error=email`);

  const supabase = await supabaseForRequest();
  if (!supabase) redirect(`${back}?error=setup`);

  // The link in the email comes back to this same site, whichever address
  // (preview, production, local) the member is using.
  const h = await headers();
  const origin = h.get("origin") ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/confirm` },
  });
  if (error) {
    console.error(`sign-in: could not send the link: ${error.status ?? ""} ${error.code ?? ""} ${error.message}`);
    redirect(`${back}?error=${error.status === 429 ? "rate" : "send"}`);
  }
  redirect(`${back}?sent=1`);
}

export async function signOut() {
  const supabase = await supabaseForRequest();
  if (supabase) {
    const { error } = await supabase.auth.signOut();
    if (error) console.error(`sign-out: ${error.message}`);
  }
  redirect("/");
}
