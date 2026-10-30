/**
 * The app's `MemberProfileStore` (core/profiles.ts): how core reaches the
 * signed-in member's own `member_profiles` row. It acts through the member's
 * session, so row-level security keeps it to their row.
 *
 * It only translates names and turns a failed database call into a thrown
 * error. Every value it writes was decided and checked in core.
 */
import type { MemberProfile, MemberProfileStore } from "../../core/profiles.ts";
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
