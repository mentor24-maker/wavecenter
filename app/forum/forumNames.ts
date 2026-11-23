/**
 * How the Forum names the member who added a topic or tag: "you", their
 * display name as the Members page shows it (each member's privacy applied by
 * list_members), "a former member" once their account is gone, or a short id.
 * If the members list cannot be read, the short id wording is used, so the
 * Forum still shows.
 */
import { listMembers } from "../lib/memberRoleStore";
import type { supabaseForRequest } from "../lib/supabase";

type Client = NonNullable<Awaited<ReturnType<typeof supabaseForRequest>>>;

export async function forumNamer(supabase: Client, me: string): Promise<(id: string | null) => string> {
  const shown = await listMembers(supabase).then(
    (members) => new Map(members.flatMap((m) => (m.displayName?.trim() ? [[m.memberId, m.displayName.trim()] as const] : []))),
    () => new Map<string, string>(),
  );
  return (id) => (id === me ? "you" : !id ? "a former member" : shown.get(id) ?? `member ${id.slice(0, 8)}`);
}
