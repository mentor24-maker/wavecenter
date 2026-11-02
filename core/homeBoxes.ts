/**
 * The words in Home's boxes, editable from Home itself (Dane, 2026-11-01:
 * "An Admin user will see a small edit icon in the lower right corner of each
 * module on the home page, other than the slider. Clicking it will launch a
 * rich text editor populated with the current content"). For now only About
 * WaveCenter and What is a DEO are editable (his "B" the same evening): the
 * other boxes show live lists WaveCenter fills in by itself.
 *
 * Who may change the words is the role's `home.edit` permission
 * (core/members.ts), granted to admins at the start. The words are written in
 * the rich-text format of task comments (core/richText.ts), so nothing typed
 * into a box can run in the browser. A box with no saved words shows the
 * words it was built with, kept here.
 *
 * Like teams (core/teams.ts), the words are reached through a store a client
 * supplies, and every change names its tool. The database's row-level
 * security repeats who may change them
 * (supabase/migrations/20261102130000_home_boxes.sql).
 */
import { STARTING_ROLE_PERMISSIONS, mayDo, roleOf, type MemberRoleStore, type RoleKey } from './members.ts';
import { CoreError, requireTool } from './tool.ts';

/** The editable boxes, in the order Home shows them, each with the words it was built with. The migration allows the same keys. */
export const HOME_BOXES = [
  { key: 'about', name: 'About WaveCenter', words: 'The hub of the DEO movement: what it is for and where it is going.' },
  { key: 'deo', name: 'What is a DEO', words: 'What a Decentralized Engagement Organization is.' },
] as const;
export type HomeBoxKey = (typeof HOME_BOXES)[number]['key'];

/** The most a box holds. The migration checks the same. */
export const HOME_BOX_MAX = 2_000;

/** One box's saved words, in core's own names. */
export interface HomeBox {
  box: HomeBoxKey;
  body: string;
  /** The tool that last changed the words. */
  tool: string;
  updatedAt: string;
  /** Null once the member who changed it has left. */
  updatedBy: string | null;
}

/** What core needs from storage for Home's boxes. */
export interface HomeBoxStore {
  /** Every box that has saved words. */
  list(): Promise<HomeBox[]>;
  /** Save the box's words, making the row if needed. Returns what is now saved, or null if nothing was. */
  save(box: HomeBoxKey, body: string, tool: string): Promise<HomeBox | null>;
}

/** What a change needs: the boxes, the actor's role, and the grants the database holds (the starting ones if not given). */
export interface HomeBoxDeps {
  boxes: HomeBoxStore;
  roles: MemberRoleStore;
  grants?: Readonly<Record<string, readonly string[]>>;
}

export function isHomeBox(value: unknown): value is HomeBoxKey {
  return HOME_BOXES.some((b) => b.key === value);
}

export function mayEditHomeBoxes(
  role: RoleKey | null | undefined,
  grants: Readonly<Record<string, readonly string[]>> = STARTING_ROLE_PERMISSIONS,
): boolean {
  return mayDo(role, 'home.edit', grants);
}

/** The words a box shows: its saved ones, or the ones it was built with when none are saved. */
export function homeBoxWords(box: HomeBoxKey, saved: readonly HomeBox[]): string {
  return saved.find((b) => b.box === box)?.body ?? HOME_BOXES.find((b) => b.key === box)!.words;
}

/** `actorId` changes a box's words, on behalf of `tool`. Throws if what comes back is not what was asked for. */
export async function saveHomeBox(
  deps: HomeBoxDeps,
  change: { actorId: string; box: string; body: string },
  tool: string,
): Promise<HomeBox> {
  const named = requireTool(tool);
  if (!isHomeBox(change.box)) throw new CoreError(`"${String(change.box)}" is not one of Home's editable boxes.`);
  if (!mayEditHomeBoxes(await roleOf(deps.roles, change.actorId), deps.grants)) {
    throw new CoreError("Your role may not change the words on Home. An admin can give it Edit Home boxes on the Admin page.");
  }
  const body = (change.body ?? '').trim();
  if (!body) throw new CoreError('A box needs some words. Nothing was changed.');
  if (body.length > HOME_BOX_MAX) throw new CoreError(`A box can hold at most ${HOME_BOX_MAX.toLocaleString('en-US')} characters.`);
  const saved = await deps.boxes.save(change.box, body, named);
  if (!saved || saved.box !== change.box || saved.body !== body) {
    throw new CoreError('The words did not save. The box is as it was; try again.');
  }
  return saved;
}
