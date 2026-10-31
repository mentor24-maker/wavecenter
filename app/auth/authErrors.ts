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
 * Where a link from a WaveCenter email goes once it has signed the member in.
 * Only a fixed list of codes is honoured, so a link cannot send anyone to
 * another site.
 */
export function afterEmailLink(next: string | null, type: string | null): "/" | "/reset-password" {
  return next === "reset" || type === "recovery" ? "/reset-password" : "/";
}
