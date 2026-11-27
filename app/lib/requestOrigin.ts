/**
 * The address this request came in on. Links in WaveCenter's emails come back
 * to this same site, whichever copy (preview, production, local) the member
 * is using. Server-only: it reads the request's headers.
 */
import { headers } from "next/headers";

export async function requestOrigin(): Promise<string> {
  const h = await headers();
  return h.get("origin") ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
}
