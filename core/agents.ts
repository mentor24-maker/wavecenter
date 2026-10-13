/**
 * Handing tasks to AI agents: the member's "Launch AI Agents" switch, and the
 * order the agents take ticked tasks in.
 *
 * A member ticks the tasks agents may work on (`agentSelected` on the task,
 * changed through `updateTask` in core/tasks.ts) and turns the switch on.
 * Agents then take the ticked tasks highest priority first, then oldest
 * first. Dane's words (2026-10-12): "in priority, then chronological order".
 *
 * Like tasks, the switch is reached through a store a client supplies, and
 * every change names its tool.
 */
import { CoreError, requireTool } from './tool.ts';
import { TASK_PRIORITIES, type Task } from './tasks.ts';

/** One member's settings row, in core's own names. */
export interface MemberSettings {
  /** The "Launch AI Agents" switch. Off until the member turns it on. */
  agentsOn: boolean;
  /** The tool that last changed this record. */
  tool: string;
}

/** What core needs from storage for the signed-in member's own settings. */
export interface MemberSettingsStore {
  /** The member's settings, or null if they have never saved any. */
  get(): Promise<MemberSettings | null>;
  /** Save the member's settings, making the row if needed. Returns what was saved. */
  save(settings: MemberSettings): Promise<MemberSettings | null>;
}

/** What a member who has never touched the switch has. */
export const DEFAULT_MEMBER_SETTINGS: MemberSettings = { agentsOn: false, tool: 'wavecenter' };

/** Turn the member's "Launch AI Agents" switch on or off, on behalf of `tool`. */
export async function setAgentsOn(store: MemberSettingsStore, on: boolean, tool: string): Promise<MemberSettings> {
  const named = requireTool(tool);
  if (typeof on !== 'boolean') throw new CoreError('The AI agents switch is on or off.');
  const saved = await store.save({ agentsOn: on, tool: named });
  if (!saved || saved.agentsOn !== on) throw new CoreError('The AI agents switch did not save. Nothing changed; try again.');
  return saved;
}

type Orderable = Pick<Task, 'agentSelected' | 'priority' | 'createdAt'> & { status: string };

/**
 * The ticked, unfinished tasks in the order agents take them: urgent, high,
 * normal, low, and within a priority the oldest first.
 */
export function agentOrder<T extends Orderable>(tasks: readonly T[]): T[] {
  const rank = (t: T) => {
    const at = TASK_PRIORITIES.indexOf(t.priority);
    return at === -1 ? TASK_PRIORITIES.length : at;
  };
  return tasks
    .filter((t) => t.agentSelected && t.status !== 'done')
    .sort((a, b) => rank(a) - rank(b) || Date.parse(a.createdAt) - Date.parse(b.createdAt));
}
