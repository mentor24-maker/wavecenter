/**
 * Keeps the sign-in session fresh. A Supabase session token lasts an hour;
 * this runs before each page request, renews the token when it is due, and
 * writes the new cookie onto the response. Pages cannot write cookies, so
 * without this a member would be signed out at random.
 *
 * Plain Next.js (proxy.ts, formerly middleware), which runs on any host.
 */
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseSettings } from "./app/lib/supabase";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const settings = supabaseSettings();
  if ("missing" in settings) return response;

  const supabase = createServerClient(settings.url, settings.anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        // Never let a shared cache hand one member's session to another.
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  // Checks the token with Supabase and refreshes it if it is due.
  await supabase.auth.getUser();
  return response;
}

export const config = {
  // Every page, but not Next's own files or static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
