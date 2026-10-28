/**
 * A member's own profile: a display name, an avatar, a short bio and who may
 * see them. The first slice of "privacy and security first"
 * (https://wavecenter.com/privacy-and-security-first/; Dane chose this slice
 * on 2026-10-27). As the article promises, a profile starts completely
 * anonymous: no name, a built-in avatar, and visibility `anonymous`. A member
 * reveals more only when they choose to.
 *
 * Masks, Filters and vendor access are later work. There is no screen yet
 * that shows one member's profile to another; `visibility` records the
 * member's choice now so that screen can honour it when it comes.
 *
 * Like the AI agents switch (core/agents.ts), the profile is reached through
 * a store a client supplies, and every change names its tool.
 */
import { CoreError, requireTool } from './tool.ts';

/**
 * Who may see a profile:
 * - `anonymous`: nobody sees anything but the avatar. Where every profile starts.
 * - `private`: only the member.
 * - `public`: other signed-in members see the display name and bio.
 */
export const PROFILE_VISIBILITIES = ['anonymous', 'private', 'public'] as const;
export type ProfileVisibility = (typeof PROFILE_VISIBILITIES)[number];

/**
 * The built-in avatars a member picks from ("users are identified by an
 * avatar"). No photo uploads in this version. The migration's check lists
 * the same ids; a test keeps the two in step.
 */
export const AVATARS = [
  { id: 'wave', label: 'Wave', symbol: '🌊' },
  { id: 'sun', label: 'Sun', symbol: '☀️' },
  { id: 'moon', label: 'Moon', symbol: '🌙' },
  { id: 'star', label: 'Star', symbol: '⭐' },
  { id: 'leaf', label: 'Leaf', symbol: '🌿' },
  { id: 'mountain', label: 'Mountain', symbol: '⛰️' },
  { id: 'flame', label: 'Flame', symbol: '🔥' },
  { id: 'shell', label: 'Shell', symbol: '🐚' },
] as const;
export type AvatarId = (typeof AVATARS)[number]['id'];

/** The longest display name and bio a profile holds. The migration checks the same. */
export const DISPLAY_NAME_MAX = 50;
export const BIO_MAX = 280;

/** One member's profile row, in core's own names. */
export interface MemberProfile {
  /** Null means none: the member is shown by their avatar alone. */
  displayName: string | null;
  avatar: AvatarId;
  bio: string | null;
  visibility: ProfileVisibility;
  /** The tool that last changed this record. */
  tool: string;
}

/** What the member asks to save. Blank text means none. */
export interface ProfileInput {
  displayName: string | null;
  avatar: string;
  bio: string | null;
  visibility: string;
}

/** What core needs from storage for the signed-in member's own profile. */
export interface MemberProfileStore {
  /** The member's profile, or null if they have never saved one. */
  get(): Promise<MemberProfile | null>;
  /** Save the member's profile, making the row if needed. Returns what was saved. */
  save(profile: MemberProfile): Promise<MemberProfile | null>;
}

/** What a member who has never saved a profile has: completely anonymous. */
export const DEFAULT_MEMBER_PROFILE: MemberProfile = {
  displayName: null,
  avatar: 'wave',
  bio: null,
  visibility: 'anonymous',
  tool: 'wavecenter',
};

/** The member's profile, or the anonymous default if they have never saved one. */
export async function loadProfile(store: MemberProfileStore): Promise<MemberProfile> {
  return (await store.get()) ?? DEFAULT_MEMBER_PROFILE;
}

function optionalText(value: unknown, what: string, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new CoreError(`Your ${what} must be text.`);
  const text = value.trim();
  if (!text) return null;
  if ([...text].length > max) throw new CoreError(`Your ${what} can be at most ${max} characters; this one has ${[...text].length}.`);
  return text;
}

/** Checks and tidies what the member asked to save, or throws a message a person can read. */
export function checkProfile(input: ProfileInput, tool: string): MemberProfile {
  const named = requireTool(tool);
  if (!AVATARS.some((a) => a.id === input.avatar)) {
    throw new CoreError(`"${String(input.avatar)}" is not one of WaveCenter's avatars. Pick one from the list.`);
  }
  if (!PROFILE_VISIBILITIES.includes(input.visibility as ProfileVisibility)) {
    throw new CoreError(`"${String(input.visibility)}" is not a visibility choice. Pick Anonymous, Private or Public.`);
  }
  return {
    displayName: optionalText(input.displayName, 'display name', DISPLAY_NAME_MAX),
    avatar: input.avatar as AvatarId,
    bio: optionalText(input.bio, 'bio', BIO_MAX),
    visibility: input.visibility as ProfileVisibility,
    tool: named,
  };
}

/**
 * Save the member's profile on behalf of `tool`. Throws if what comes back
 * is not what was asked for, so a failed save is never reported as saved.
 */
export async function saveProfile(store: MemberProfileStore, input: ProfileInput, tool: string): Promise<MemberProfile> {
  const profile = checkProfile(input, tool);
  const saved = await store.save(profile);
  if (
    !saved ||
    saved.displayName !== profile.displayName ||
    saved.avatar !== profile.avatar ||
    saved.bio !== profile.bio ||
    saved.visibility !== profile.visibility
  ) {
    throw new CoreError('Your profile did not save. Nothing changed; try again.');
  }
  return saved;
}
