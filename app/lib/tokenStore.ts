/**
 * The app's `TokenStore` (core/tokens.ts): how core reaches the token sizes.
 * It acts through the member's session, so row-level security decides what
 * it may read and change (every member reads; a role with `game.edit`
 * changes), repeating core's rules.
 *
 * It only translates names and turns a failed database call into a thrown
 * error. Every value it writes was decided and checked in core.
 */
import type { TokenSize, TokenSizeFields, TokenStore } from "../../core/tokens.ts";
import type { supabaseForRequest } from "./supabase";

type Client = NonNullable<Awaited<ReturnType<typeof supabaseForRequest>>>;

const COLUMNS = "id,name,diameter,color,min_points,tool,updated_at";

function fromRow(r: any): TokenSize {
  return { id: r.id, name: r.name, diameter: r.diameter, color: r.color, minPoints: r.min_points, tool: r.tool, updatedAt: r.updated_at };
}

function toRow(fields: TokenSizeFields, tool: string) {
  return { name: fields.name, diameter: fields.diameter, color: fields.color, min_points: fields.minPoints, tool };
}

/** The database's own refusal of a shared point level, in plain words. */
function refused(what: string, error: { code?: string; message: string }) {
  if (error.code === "23505") return new Error("Two sizes cannot share a point level.");
  return new Error(`The database refused to ${what}: ${error.message}`);
}

export function supabaseTokenStore(supabase: Client): TokenStore {
  return {
    list: () => listTokenSizes(supabase),
    async add(fields, tool) {
      const { data, error } = await supabase.from("token_sizes").insert(toRow(fields, tool)).select(COLUMNS).maybeSingle();
      if (error) throw refused("add the token size", error);
      return data ? fromRow(data) : null;
    },
    async change(id, fields, tool) {
      const { data, error } = await supabase.from("token_sizes").update(toRow(fields, tool)).eq("id", id).select(COLUMNS).maybeSingle();
      if (error) throw refused("change the token size", error);
      return data ? fromRow(data) : null;
    },
    async remove(id) {
      const { data, error } = await supabase.from("token_sizes").delete().eq("id", id).select("id");
      if (error) throw refused("remove the token size", error);
      return (data ?? []).length > 0;
    },
  };
}

/** Every token size, smallest point level first. */
export async function listTokenSizes(supabase: Client): Promise<TokenSize[]> {
  const { data, error } = await supabase.from("token_sizes").select(COLUMNS).order("min_points");
  if (error) throw new Error(`The database refused to read the token sizes: ${error.message}`);
  return (data ?? []).map(fromRow);
}
