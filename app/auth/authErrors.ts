/**
 * Turns what Supabase says about a register, log-in or reset attempt into a
 * short code the page shows fixed text for. Plain TypeScript, no framework,
 * so the choices can be tested on their own.
 *
 * Every page shows fixed text chosen by the code, so nothing typed into the
 * address bar is ever echoed onto the page.
 */

/** The shortest password WaveCenter accepts. Supabase's own floor is 6. */
export const MIN_PASSWORD_LENGTH = 8;

/** The parts of a Supabase AuthError these choices read. */
export type AuthFailure = { status?: number; code?: string; message?: string };

export function looksLikeEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** A problem with a new password before it is sent anywhere, or null. */
export function passwordProblem(password: string, confirm: string): "short" | "mismatch" | null {
  if (password.length < MIN_PASSWORD_LENGTH) return "short";
  if (password !== confirm) return "mismatch";
  return null;
}

const rateLimited = (e: AuthFailure) =>
  e.status === 429 || e.code === "over_email_send_rate_limit" || e.code === "over_request_rate_limit";

/** Registering failed. */
export function registerFailure(e: AuthFailure): "taken" | "short" | "rate" | "send" {
  if (e.code === "user_already_exists" || e.code === "email_exists") return "taken";
  if (e.code === "weak_password") return "short";
  if (rateLimited(e)) return "rate";
  return "send";
}

/** Logging in with email and password failed. */
export function signInFailure(e: AuthFailure): "mismatch" | "unconfirmed" | "rate" | "failed" {
  if (e.code === "invalid_credentials") return "mismatch";
  if (e.code === "email_not_confirmed") return "unconfirmed";
  if (rateLimited(e)) return "rate";
  return "failed";
}

/** Sending the "set a new password" email failed. */
export function resetFailure(e: AuthFailure): "rate" | "send" {
  return rateLimited(e) ? "rate" : "send";
}

/**
 * Where the log-in form's "not confirmed" message sends a member whose
 * confirmation email never came: the register page's "Check your email"
 * screen with its resend form already open. A fixed address: nothing the
 * visitor typed (above all, never their email) goes into it.
 */
export const RESEND_CONFIRMATION_PAGE = "/register?sent=1&resend=1";

/**
 * Whether the register page shows its resend form already open: when the
 * member came asking for it (`resend`), and after a send or a failed one,
 * so its answer sits beside the form.
 */
export function resendFormOpen(params: { resend?: string; resent?: string; error?: string }): boolean {
  return Boolean(params.resend || params.resent || params.error);
}

/** Sending the confirmation email again (from the register page's "Check your email" screen) failed. */
export function resendFailure(e: AuthFailure): "rate" | "resend" {
  return rateLimited(e) ? "rate" : "resend";
}

/** Saving a new password failed. */
export function newPasswordFailure(e: AuthFailure): "short" | "same" | "expired" | "failed" {
  if (e.code === "weak_password") return "short";
  if (e.code === "same_password") return "same";
  if (e.code === "session_not_found" || e.code === "session_expired" || e.code === "reauthentication_needed") {
    return "expired";
  }
  return "failed";
}

/**
 * Where an email-change link sends the member: their profile page, which
 * reads the account and says what is true (still waiting for the other link,
 * or the new address in place). Supabase does not tell the server which of
 * the two links this was, so the page never guesses.
 */
export const EMAIL_LINK_PAGE = "/profile?email=link";

/** Whether a link is one of the two change-your-email links (`next=email`, or `type=email_change` from a customised template). */
export function isEmailChangeLink(next: string | null, type: string | null): boolean {
  return next === "email" || type === "email_change";
}

/**
 * Where an email-change link goes when Supabase refused it (expired, or
 * already used): the profile page with its own note, which names the address
 * the account still has. Any other refused link goes to the log-in page.
 */
export const EMAIL_LINK_EXPIRED_PAGE = "/profile?email=expired";

export function afterRefusedEmailLink(
  next: string | null,
  type: string | null,
): "/sign-in?error=expired" | typeof EMAIL_LINK_EXPIRED_PAGE {
  return isEmailChangeLink(next, type) ? EMAIL_LINK_EXPIRED_PAGE : "/sign-in?error=expired";
}

/**
 * The log-in page's two email-change notes, for a member who opened the
 * link signed out (on a phone, say): `email-link` when the link was opened,
 * `email-expired` when Supabase refused it. The profile page cannot show
 * either to a signed-out visitor, so it sends them here with the marker.
 */
export const EMAIL_LINK_SIGNED_OUT = { link: "/sign-in?error=email-link", expired: "/sign-in?error=email-expired" } as const;

/** The profile page's `?email=` marker for a signed-out visitor: where they go instead. */
export function signedOutProfilePage(emailMarker: string | undefined): string {
  if (emailMarker === "link") return EMAIL_LINK_SIGNED_OUT.link;
  if (emailMarker === "expired") return EMAIL_LINK_SIGNED_OUT.expired;
  return "/sign-in";
}

/**
 * The log-in page's email-change marker for a visitor who is in fact signed
 * in (the link opened in the same browser after all): back to the profile
 * page with the matching note. Anyone else signed in goes home, as before.
 */
export function signedInSignInPage(error: string | undefined): "/" | typeof EMAIL_LINK_PAGE | typeof EMAIL_LINK_EXPIRED_PAGE {
  if (error === "email-link") return EMAIL_LINK_PAGE;
  if (error === "email-expired") return EMAIL_LINK_EXPIRED_PAGE;
  return "/";
}

/**
 * Where a link from a WaveCenter email goes once it has signed the member in.
 * Only a fixed list of codes is honoured, so a link cannot send anyone to
 * another site.
 */
export function afterEmailLink(
  next: string | null,
  type: string | null,
): "/" | "/reset-password" | typeof EMAIL_LINK_PAGE {
  if (next === "reset" || type === "recovery") return "/reset-password";
  if (isEmailChangeLink(next, type)) return EMAIL_LINK_PAGE;
  return "/";
}

/** A problem with a new email address before it is sent anywhere, or null. */
export function emailChangeProblem(newEmail: string, currentEmail: string | null | undefined): "email" | "same" | null {
  if (!looksLikeEmail(newEmail)) return "email";
  if (currentEmail && newEmail.toLowerCase() === currentEmail.toLowerCase()) return "same";
  return null;
}

/** Asking Supabase to change the member's email failed. */
export function emailChangeFailure(e: AuthFailure): "taken" | "email" | "rate" | "signed-out" | "failed" {
  if (e.code === "email_exists" || e.code === "user_already_exists") return "taken";
  // Not `validation_failed`: Supabase uses it for other things too (a bad redirect address, say).
  if (e.code === "email_address_invalid") return "email";
  if (rateLimited(e)) return "rate";
  if (e.code === "session_not_found" || e.code === "session_expired" || e.code === "reauthentication_needed" || e.status === 401) {
    return "signed-out";
  }
  return "failed";
}

/** What the profile page says for each email-change failure. Fixed text, never Supabase's own words. */
export const EMAIL_CHANGE_ERRORS: Record<NonNullable<ReturnType<typeof emailChangeProblem>> | ReturnType<typeof emailChangeFailure>, string> = {
  email: "That does not look like an email address. Nothing was changed.",
  same: "That is already your email address. Nothing was changed.",
  taken: "That address is already in use by another account. Nothing was changed.",
  rate: "Too many emails have been sent in a short time. Nothing was changed; wait a few minutes and try again.",
  "signed-out": "You are signed out, so nothing was changed. Reload the page and log in again.",
  failed: "WaveCenter could not start the change. Nothing was changed; try again in a minute.",
};

/**
 * Whether Google sign-in is switched on, read from what Supabase's public
 * `/auth/v1/settings` answers (`{ external: { google: true } }`). Anything
 * that is not a plain `true` or `false` there means we could not tell.
 */
export function googleSwitchedOn(settings: unknown): "on" | "off" | "unknown" {
  const external = (settings as { external?: Record<string, unknown> } | null)?.external;
  if (!external || typeof external !== "object") return "unknown";
  if (external.google === true) return "on";
  if (external.google === false) return "off";
  return "unknown";
}

/**
 * Why a Google sign-in came back without signing anyone in, from what
 * Supabase put on the address it sent the browser back to. Cancelling at
 * Google comes back as `error=access_denied`.
 */
export function googleReturnFailure(error: string | null, errorCode: string | null): "google-cancelled" | "google-failed" {
  return error === "access_denied" || errorCode === "access_denied" ? "google-cancelled" : "google-failed";
}

/**
 * The page a Google button's message goes back to. Only the pages the button
 * sits on are honoured, so the form cannot send a visitor anywhere else.
 */
export function googleButtonPage(from: string): "/" | "/sign-in" | "/register" {
  return from === "/" || from === "/register" ? from : "/sign-in";
}
