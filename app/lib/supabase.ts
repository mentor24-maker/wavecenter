/**
 * The one way app code talks to Supabase: a server-side client that acts as
 * whoever is signed in, using their session cookie. Every read and write goes
 * through that session, so the row-level security rules on each table decide
 * what comes back (docs/DATA_MODEL.md).
 *
 * Server only. Nothing here is ever sent to the browser: the browser holds no
 * Supabase key at all, only the session cookie. The service role key, which
 * ignores row-level security, is never read by app code (engineering rule 3).
 */
import { createServerClient } from "@supabase/ssr";
import { isAuthSessionMissingError } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/** The two settings sign-in needs, read when a request arrives, not at build. */
export function supabaseSettings(): { url: string; anonKey: string } | { missing: string[] } {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (url && anonKey) return { url, anonKey };
  return { missing: [!url && "SUPABASE_URL", !anonKey && "SUPABASE_ANON_KEY"].filter(Boolean) as string[] };
}

/**
 * A Supabase client for this request, or null when this deployment has not
 * been given the settings (the caller says so on screen; rule 7).
 * Make a new one per request; never share one between requests.
 */
export async function supabaseForRequest() {
  // Read the cookies first, always: it marks every page that calls this as
  // per-request, so a signed-in page is never baked in at build time.
  const cookieStore = await cookies();
  const settings = supabaseSettings();
  if ("missing" in settings) return null;
  return createServerClient(settings.url, settings.anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // A page render cannot write cookies. That is fine: proxy.ts has
          // already refreshed the session cookie for this request.
        }
      },
    },
  });
}

type Client = NonNullable<Awaited<ReturnType<typeof supabaseForRequest>>>;

/**
 * Who is signed in. "No session" is the ordinary signed-out answer; any other
 * error (Supabase unreachable, a bad response) means we could not tell, and
 * the caller must say so rather than show a signed-in member the signed-out
 * page (engineering rule 7).
 */
export async function currentUser(supabase: Client) {
  const { data, error } = await supabase.auth.getUser();
  if (error && !isAuthSessionMissingError(error)) return { user: null, checkFailed: true as const };
  return { user: data.user, checkFailed: false as const };
}

/** Shown when currentUser() could not tell. Never shown to plain signed-out visitors. */
export const SIGN_IN_CHECK_FAILED =
  "WaveCenter could not check whether you are signed in. Try reloading in a minute.";
