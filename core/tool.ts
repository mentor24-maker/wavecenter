/**
 * Every change to a task names the tool that made it (Dane's decision D on
 * the extension model, 2026-10-11; docs/EXTENSION_MODEL.md). WaveCenter's own
 * screens are the tool `wavecenter`; a member-built tool will have its own
 * name. A change with no tool name is refused, so no record is ever written
 * without saying where it came from.
 */

/** A rule in core/ was broken. The message is written for a person to read. */
export class CoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoreError';
  }
}

/** WaveCenter's own app. */
export const WAVECENTER_TOOL = 'wavecenter';

/** The lane on the Mini that hands ticked tasks to the Loop Queue (core/agents.ts). */
export const LOOP_HANDOFF_TOOL = 'loop-handoff';

/** Returns the tool name trimmed, or throws if there is none. */
export function requireTool(tool: unknown): string {
  if (typeof tool !== 'string' || tool.trim() === '') {
    throw new CoreError(
      'Every change to a task must name the tool making it (for example "wavecenter"), and none was given.',
    );
  }
  return tool.trim();
}
