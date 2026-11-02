/**
 * The app's `HomeBoxStore` (core/homeBoxes.ts): how core reaches the words in
 * Home's boxes. It acts through the member's session, so row-level security
 * decides what it may read and change (every member reads; a role with
 * `home.edit` changes), repeating core's rules.
 *
 * It only translates names and turns a failed database call into a thrown
 * error. Every value it writes was decided and checked in core.
 */
import type { HomeBox, HomeBoxStore } from "../../core/homeBoxes.ts";
import type { supabaseForRequest } from "./supabase";

type Client = NonNullable<Awaited<ReturnType<typeof supabaseForRequest>>>;

const COLUMNS = "box,body,tool,updated_at,updated_by";

function fromRow(r: any): HomeBox {
  return { box: r.box, body: r.body, tool: r.tool, updatedAt: r.updated_at, updatedBy: r.updated_by };
}

export function supabaseHomeBoxStore(supabase: Client): HomeBoxStore {
  return {
    list: () => listHomeBoxes(supabase),
    async save(box, body, tool) {
      const { data, error } = await supabase
        .from("home_boxes")
        .upsert({ box, body, tool }, { onConflict: "box" })
        .select(COLUMNS)
        .maybeSingle();
      if (error) throw new Error(`The database refused to save the box's words: ${error.message}`);
      return data ? fromRow(data) : null;
    },
  };
}

/** Every box that has saved words. */
export async function listHomeBoxes(supabase: Client): Promise<HomeBox[]> {
  const { data, error } = await supabase.from("home_boxes").select(COLUMNS);
  if (error) throw new Error(`The database refused to read Home's boxes: ${error.message}`);
  return (data ?? []).map(fromRow);
}
