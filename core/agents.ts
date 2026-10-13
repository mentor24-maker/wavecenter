/**
 * Handing tasks to AI agents: the member's "Launch AI Agents" switch, and the
 * order the agents take ticked tasks in.
 *
 * A member ticks the tasks agents may work on (`agentSelected` on the task,
 * changed through `updateTask` in core/tasks.ts) and turns the switch on.
 * Agents then take the ticked tasks highest priority first, then oldest
 * first. Dane's words (2026-10-12): "in priority, then chronological order".
 *
 * The loop-handoff lane then files each one as a Loop Queue ticket and
 * records it here (`handOffTask`). When the ticket goes Live the task is done
 * (`completeHandOff`); when it is closed without being built, the task comes
 * back to the member (`returnHandOff`). Only these three change a task's
 * ticket link.
 *
 * Like tasks, the switch is reached through a store a client supplies, and
 * every change names its tool.
 */
import { CoreError, requireTool } from './tool.ts';
import { TASK_PRIORITIES, type Task, type TaskStore } from './tasks.ts';

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

type Orderable = Pick<Task, 'agentSelected' | 'priority' | 'createdAt'> & {
  status: string;
  agentTicketUrl?: string | null;
};

/**
 * The ticked, unfinished tasks still waiting for agents, in the order agents
 * take them: urgent, high, normal, low, and within a priority the oldest
 * first. A task already handed to a ticket is no longer waiting.
 */
export function agentOrder<T extends Orderable>(tasks: readonly T[]): T[] {
  const rank = (t: T) => {
    const at = TASK_PRIORITIES.indexOf(t.priority);
    return at === -1 ? TASK_PRIORITIES.length : at;
  };
  return tasks
    .filter((t) => t.agentSelected && t.status !== 'done' && !t.agentTicketUrl)
    .sort((a, b) => rank(a) - rank(b) || Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

function requireTicketUrl(url: unknown): string {
  if (typeof url !== 'string' || !/^https:\/\/\S+$/.test(url.trim())) {
    throw new CoreError(`A ticket link must be a full https:// address; got "${String(url)}".`);
  }
  return url.trim();
}

/**
 * Record that a ticked task was handed to the ticket at `ticketUrl`: it
 * becomes "doing" and carries the link. The write only lands if the task
 * still has no ticket, so two hand-offs at once can never both record one.
 */
export async function handOffTask(store: TaskStore, id: string, ticketUrl: string, tool: string): Promise<Task> {
  const named = requireTool(tool);
  const url = requireTicketUrl(ticketUrl);
  const task = await store.get(id);
  if (!task) throw new CoreError(`No task ${id} was found to hand to AI agents.`);
  if (task.agentTicketUrl) throw new CoreError(`"${task.title}" was already handed to AI agents (${task.agentTicketUrl}).`);
  if (!task.agentSelected) throw new CoreError(`"${task.title}" is not ticked for AI agents, so it was not handed over.`);
  if (task.status === 'done') throw new CoreError(`"${task.title}" is already done, so it was not handed over.`);
  const saved = await store.update(id, { status: 'doing', agentTicketUrl: url, tool: named }, { agentTicketUrl: null });
  if (!saved) throw new CoreError(`"${task.title}" was handed to AI agents by another pass first. Nothing was recorded.`);
  return saved;
}

/** The task's ticket went Live: the task is done. Its ticket link is kept as the record of who did it. */
export async function completeHandOff(store: TaskStore, id: string, ticketUrl: string, tool: string): Promise<Task> {
  const named = requireTool(tool);
  const url = requireTicketUrl(ticketUrl);
  const saved = await store.update(id, { status: 'done', agentSelected: false, tool: named }, { agentTicketUrl: url });
  if (!saved) throw new CoreError(`Task ${id} is no longer handed to ${url}. Nothing was changed.`);
  return saved;
}

/**
 * The task's ticket was closed without being built: the task goes back to
 * todo, unticked and with no ticket, and `why` is added to its notes so the
 * member can see what happened.
 */
export async function returnHandOff(store: TaskStore, id: string, ticketUrl: string, why: string, tool: string): Promise<Task> {
  const named = requireTool(tool);
  const url = requireTicketUrl(ticketUrl);
  if (typeof why !== 'string' || !why.trim()) throw new CoreError('Handing a task back needs a reason the member can read.');
  const task = await store.get(id);
  if (!task || task.agentTicketUrl !== url) throw new CoreError(`Task ${id} is no longer handed to ${url}. Nothing was changed.`);
  const notes = task.notes?.trim() ? `${task.notes.trim()}\n\n${why.trim()}` : why.trim();
  const saved = await store.update(
    id,
    { status: 'todo', agentSelected: false, agentTicketUrl: null, notes, tool: named },
    { agentTicketUrl: url },
  );
  if (!saved) throw new CoreError(`Task ${id} changed while it was being handed back. Nothing was changed.`);
  return saved;
}
