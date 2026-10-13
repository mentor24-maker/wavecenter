/**
 * The app's `MemberSettingsStore` (core/agents.ts): how core reaches the
 * signed-in member's own `member_settings` row. It acts through the member's
 * session, so row-level security keeps it to their row.
 *
 * It only translates names and turns a failed database call into a thrown
 * error. Every value it writes was decided and checked in core.
 */
import type { MemberSettings, MemberSettingsStore } from "../../core/agents.ts";
import type { supabaseForRequest } from "./supabase";

type Client = NonNullable<Awaited<ReturnType<typeof supabaseForRequest>>>;

export function fromSettingsRow(row: any): MemberSettings {
  return { agentsOn: row.agents_on, tool: row.tool };
}

export function supabaseMemberSettingsStore(supabase: Client, ownerId: string): MemberSettingsStore {
  return {
    async get() {
      const { data, error } = await supabase.from("member_settings").select().eq("owner_id", ownerId).maybeSingle();
      if (error) throw new Error(`The database refused to read your settings: ${error.message}`);
      return data ? fromSettingsRow(data) : null;
    },
    async save(settings) {
      const { data, error } = await supabase
        .from("member_settings")
        .upsert({ owner_id: ownerId, agents_on: settings.agentsOn, tool: settings.tool }, { onConflict: "owner_id" })
        .select()
        .maybeSingle();
      if (error) throw new Error(`The database refused to save your settings: ${error.message}`);
      return data ? fromSettingsRow(data) : null;
    },
  };
}
