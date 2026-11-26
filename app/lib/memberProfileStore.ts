/**
 * The app's `MemberProfileStore` (core/profiles.ts): how core reaches the
 * signed-in member's own `member_profiles` row. It acts through the member's
 * session, so row-level security keeps it to their row.
 *
 * It only translates names and turns a failed database call into a thrown
 * error. Every value it writes was decided and checked in core.
 */
import type { MemberProfile, MemberProfileStore, ProfileReply } from "../../core/profiles.ts";
import type { supabaseForRequest } from "./supabase";

type Client = NonNullable<Awaited<ReturnType<typeof supabaseForRequest>>>;

export function fromProfileRow(row: any): MemberProfile {
  return {
    displayName: row.display_name,
    avatar: row.avatar,
    bio: row.bio,
    visibility: row.visibility,
    tool: row.tool,
  };
}

export function supabaseMemberProfileStore(supabase: Client, ownerId: string): MemberProfileStore {
  return {
    async get() {
      const { data, error } = await supabase.from("member_profiles").select().eq("owner_id", ownerId).maybeSingle();
      if (error) throw new Error(`The database refused to read your profile: ${error.message}`);
      return data ? fromProfileRow(data) : null;
    },
    async save(profile) {
      const { data, error } = await supabase
        .from("member_profiles")
        .upsert(
          {
            owner_id: ownerId,
            display_name: profile.displayName,
            avatar: profile.avatar,
            bio: profile.bio,
            visibility: profile.visibility,
            tool: profile.tool,
          },
          { onConflict: "owner_id" },
        )
        .select()
        .maybeSingle();
      if (error) throw new Error(`The database refused to save your profile: ${error.message}`);
      return data ? fromProfileRow(data) : null;
    },
  };
}

/**
 * For the header: the name the signed-in member set on their profile, or
 * their email when they have not set one. A failed read also falls back to
 * the email, so the page still loads.
 */
export async function headerName(supabase: Client, user: { id: string; email?: string | null }): Promise<string> {
  const email = user.email ?? "you";
  try {
    const name = (await supabaseMemberProfileStore(supabase, user.id).get())?.displayName?.trim();
    return name || email;
  } catch {
    return email;
  }
}

/**
 * One member's profile as another member may see it (WC-238), from the
 * database's `member_profile()` function
 * (supabase/migrations/20261126120000_member_profile_page.sql). Null means
 * the profile is Private or there is no such member; the database does not
 * say which. A failed read throws; it never becomes "nothing to show".
 */
export async function readMemberProfile(supabase: Client, memberId: string): Promise<ProfileReply | null> {
  const { data, error } = await supabase.rpc("member_profile", { member: memberId });
  if (error) throw new Error(`The database refused to read this member's profile: ${error.message}`);
  if (data === null || data === undefined) return null;
  if (typeof data !== "object" || Array.isArray(data)) throw new Error("The database's reply for this member's profile could not be read.");
  const r = data as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" ? v : null);
  return { avatar: text(r.avatar), displayName: text(r.display_name), bio: text(r.bio) };
}
