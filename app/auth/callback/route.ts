/**
 * Where a Google sign-in comes back to. Google returns the browser to
 * Supabase, which sends it here with a one-time `?code=`; this route trades
 * the code for a session cookie and sends the member home. The code only
 * works in the browser that clicked "Continue with Google" (Supabase's PKCE
 * flow: the click left a matching cookie).
 *
 * A sign-in cancelled at Google, refused by Supabase, or arriving with no
 * code lands on /sign-in with a plain message, never a blank page.
 */
import { NextResponse, type NextRequest } from "next/server";
import { supabaseForRequest } from "../../lib/supabase";
import { googleReturnFailure } from "../authErrors";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const to = (path: string) => NextResponse.redirect(new URL(path, request.url));

  if (params.get("error") || params.get("error_code")) {
    console.error(
      `Google sign-in refused: ${params.get("error")} ${params.get("error_code")} ${params.get("error_description")}`,
    );
    return to(`/sign-in?error=${googleReturnFailure(params.get("error"), params.get("error_code"))}`);
  }

  const supabase = await supabaseForRequest();
  if (!supabase) return to("/sign-in?error=setup");

  const code = params.get("code");
  if (!code) {
    console.error("Google sign-in came back with no code");
    return to("/sign-in?error=google-failed");
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error(`Google sign-in failed: ${error.message}`);
    return to("/sign-in?error=google-failed");
  }
  return to("/");
}
