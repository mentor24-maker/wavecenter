/**
 * Where the link in the sign-in email lands. It trades the one-time code in
 * the link for a session cookie, then sends the member to their tasks.
 *
 * Supabase's default email sends `?code=` (the PKCE flow: the code only works
 * in the browser that asked for the link). A customised email template may
 * send `?token_hash=&type=` instead; both are accepted.
 */
import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseForRequest } from "../../lib/supabase";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const to = (path: string) => NextResponse.redirect(new URL(path, request.url));

  // Supabase itself reports an expired or already-used link this way.
  if (params.get("error") || params.get("error_code")) {
    console.error(`sign-in link refused by Supabase: ${params.get("error_code")} ${params.get("error_description")}`);
    return to("/sign-in?error=expired");
  }

  const supabase = await supabaseForRequest();
  if (!supabase) return to("/sign-in?error=setup");

  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;

  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      : { error: new Error("the link had no code in it") };

  if (error) {
    console.error(`sign-in link failed: ${error.message}`);
    return to("/sign-in?error=link");
  }
  return to("/");
}
