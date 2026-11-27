/**
 * Where the links in WaveCenter's emails land: the confirm-your-address email
 * sent on registering, the set-a-new-password email and the two
 * change-your-email emails (WC-255). It trades the one-time code in the link
 * for a session cookie, then sends the member on: a reset link to the
 * set-a-new-password page, an email-change link to the profile page,
 * everything else home.
 *
 * An email-change link always goes on to the profile page, which reads the
 * account and says what is true. With "Secure email change" on, the first of
 * the two links comes back with no code, only Supabase's "open the other
 * link too" note, and nothing says which link it was. And by the
 * time a link reaches here Supabase has already applied it, so a code that
 * cannot be traded (the link opened in another browser) does not mean the
 * change failed: that visitor goes to the log-in page with a note saying the
 * link was opened. A link Supabase refused (expired, already used) goes to
 * the profile page with a note saying so.
 *
 * Supabase's default email sends `?code=` (the PKCE flow: the code only works
 * in the browser that registered or asked for the reset). A customised email
 * template may send `?token_hash=&type=` instead; both are accepted.
 */
import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseForRequest } from "../../lib/supabase";
import { afterEmailLink, afterRefusedEmailLink, EMAIL_LINK_PAGE, EMAIL_LINK_SIGNED_OUT, isEmailChangeLink } from "../authErrors";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const to = (path: string) => NextResponse.redirect(new URL(path, request.url));

  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  const emailChange = isEmailChangeLink(params.get("next"), type);

  // Supabase itself reports an expired or already-used link this way. An
  // email-change link goes to the profile page, which says the link failed
  // and names the address the account still has (the log-in page would send
  // a signed-in member straight home, saying nothing).
  if (params.get("error") || params.get("error_code")) {
    console.error(`email link refused by Supabase: ${params.get("error_code")} ${params.get("error_description")}`);
    return to(afterRefusedEmailLink(params.get("next"), type));
  }

  if (emailChange && !code && !tokenHash) return to(EMAIL_LINK_PAGE);

  const supabase = await supabaseForRequest();
  if (!supabase) return to("/sign-in?error=setup");

  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      : { error: new Error("the link had no code in it") };

  if (error) {
    console.error(`email link failed: ${error.message}`);
    // An email-change link that cannot sign this browser in was still
    // applied by Supabase; the log-in page says so (and sends a member who
    // is signed in after all on to the profile page).
    return to(emailChange ? EMAIL_LINK_SIGNED_OUT.link : "/sign-in?error=link");
  }
  return to(afterEmailLink(params.get("next"), type));
}
