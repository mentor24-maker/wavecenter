"use server";

/**
 * Sign-in and sign-out, run on the server. The browser only submits a form;
 * it never holds a Supabase key.
 */
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseForRequest } from "../lib/supabase";

/** Email the member a one-time sign-in link (a "magic link"). */
export async function sendMagicLink(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) redirect("/sign-in?error=email");

  const supabase = await supabaseForRequest();
  if (!supabase) redirect("/sign-in?error=setup");

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
    redirect(`/sign-in?error=${error.status === 429 ? "rate" : "send"}`);
  }
  redirect("/sign-in?sent=1");
}

export async function signOut() {
  const supabase = await supabaseForRequest();
  if (supabase) {
    const { error } = await supabase.auth.signOut();
    if (error) console.error(`sign-out: ${error.message}`);
  }
  redirect("/");
}
