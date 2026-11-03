import Link from "next/link";
import { redirect } from "next/navigation";
import { mayDo, mayOpenAdmin, ROLES, STARTING_ROLE_PERMISSIONS, type RoleKey } from "../../core/members.ts";
import { listMessages, type SavedMessage } from "../../core/messages.ts";
import { loadProfile, type MemberProfile } from "../../core/profiles.ts";
import { shownName } from "../members/memberView";
import { headerPoints } from "../lib/engagementStore";
import { supabaseMemberProfileStore } from "../lib/memberProfileStore";
import { listMembers, myRole, readRolesAndPermissions, type MemberRow } from "../lib/memberRoleStore";
import { supabaseMessageStore } from "../lib/messageStore";
import { currentUser, SIGN_IN_CHECK_FAILED, supabaseForRequest } from "../lib/supabase";
import SiteHeader from "../SiteHeader";
import Messaging, { type Recipient, type ShownMessage } from "./Messaging";
import PrivacySummary from "./PrivacySummary";
import ProfileForm from "./ProfileForm";

/** Messages and join dates are shown in Mountain time, Dane's own. */
const WHEN = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const DAY = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "short", day: "numeric", year: "numeric" });

type Read<T> = { value: T; error: null } | { value: null; error: string };

async function read<T>(load: () => Promise<T>): Promise<Read<T>> {
  try {
    return { value: await load(), error: null };
  } catch (err) {
    return { value: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Everyone but the member, by the name their profile shows; two members who show the same name are told apart by when they joined. */
function recipientsFrom(members: MemberRow[], me: string): Recipient[] {
  const others = members.filter((m) => m.memberId !== me);
  const count = new Map<string, number>();
  for (const m of others) count.set(shownName(m), (count.get(shownName(m)) ?? 0) + 1);
  return others
    .map((m) => ({
      memberId: m.memberId,
      label: (count.get(shownName(m)) ?? 0) > 1 ? `${shownName(m)} (joined ${DAY.format(new Date(m.joinedAt))})` : shownName(m),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base", numeric: true }));
}

function shownMessages(messages: SavedMessage[], me: string, members: MemberRow[] | null): ShownMessage[] {
  const byId = new Map((members ?? []).map((m) => [m.memberId, shownName(m)]));
  return messages.map((m) => {
    const direction = m.senderId === me && m.recipientId === me ? "self" : m.senderId === me ? "to" : "from";
    const otherId = direction === "from" ? m.senderId : m.recipientId;
    return { id: m.id, direction, other: byId.get(otherId) ?? "a member", subject: m.subject, body: m.body, when: WHEN.format(new Date(m.sentAt)) };
  });
}

/** Why the member cannot send, or null if they can. */
function sendBlockedBy(role: Read<RoleKey>, grants: Readonly<Record<string, readonly string[]>>, members: Read<MemberRow[]>): string | null {
  if (role.error !== null) return `Your role could not be loaded, so Send Message is off: ${role.error}. Try reloading the page.`;
  if (!mayDo(role.value, "member.message", grants)) {
    return `Your role, ${ROLES.find((r) => r.key === role.value)?.name ?? role.value}, cannot send messages yet.`;
  }
  if (members.error !== null) return `The list of members could not be loaded, so there is no one to pick: ${members.error}. Try reloading the page.`;
  return null;
}

/**
 * "Your profile": the signed-in member's display name, avatar, bio and who
 * may see them (core/profiles.ts). A member who has never saved one sees the
 * anonymous default, and the page says so. Below it, a short note on how
 * WaveCenter treats privacy, shown whatever happens to the profile itself.
 * To the right of the form, Messaging: the messages the member sent or
 * received, and a Send Message form for any role with "Message members"
 * (every role; Dane, 2026-11-01, "B"). Signed-out visitors are sent to sign
 * in.
 */
export default async function Profile() {
  const supabase = await supabaseForRequest();
  const { user, checkFailed } = supabase ? await currentUser(supabase) : { user: null, checkFailed: false };

  if (!supabase || !user) {
    if (supabase && !checkFailed) redirect("/sign-in");
    return (
      <>
        <SiteHeader />
        <main>
          <h1>Your profile</h1>
          <p className="error" role="alert">
            {!supabase ? "This copy of WaveCenter has no database settings, so there is no profile to show." : SIGN_IN_CHECK_FAILED}
          </p>
        </main>
      </>
    );
  }

  const [role, lists, members, messages, points] = await Promise.all([
    read(() => myRole(supabase, user.id)),
    read(() => readRolesAndPermissions(supabase)),
    read(() => listMembers(supabase)),
    read(() => listMessages(supabaseMessageStore(supabase), user.id)),
    headerPoints(supabase, user.id),
  ]);
  const isAdmin = role.error === null && mayOpenAdmin(role.value);
  // The database's grants when they could be read; the starting ones
  // otherwise. send_message checks the database's own either way.
  const grants = lists.value?.grants ?? STARTING_ROLE_PERMISSIONS;
  const messaging = (
    <Messaging
      messages={messages.value ? shownMessages(messages.value, user.id, members.value) : []}
      readError={messages.error}
      recipients={members.value ? recipientsFrom(members.value, user.id) : []}
      sendBlocked={sendBlockedBy(role, grants, members)}
    />
  );
  let profile: MemberProfile | null = null;
  let neverSaved = false;
  let readError: string | null = null;
  try {
    const store = supabaseMemberProfileStore(supabase, user.id);
    neverSaved = (await store.get()) === null;
    profile = await loadProfile(store);
  } catch (err) {
    readError = err instanceof Error ? err.message : String(err);
  }

  return (
    <>
      <SiteHeader name={profile?.displayName?.trim() || (user.email ?? "you")} isAdmin={isAdmin} points={points} />
      <main>
        <h1>Your profile</h1>
        <p className="lede">
          Your profile starts completely anonymous. You choose what, if anything, other members can see.{" "}
          <Link href="/privacy">Why WaveCenter puts privacy first</Link>
        </p>
        <div className="profile-top">
          <div>
            {readError !== null || !profile ? (
              <p className="error" role="alert">
                Your profile could not be loaded: {readError}. Nothing is shown so nothing wrong is saved over it; try reloading the page.
              </p>
            ) : (
              <>
                {neverSaved && (
                  <p className="note" role="status">
                    You have not set up a profile yet, so you are <strong>Anonymous</strong>: no name, just an avatar.
                  </p>
                )}
                <div className="panel">
                  <ProfileForm initial={profile} />
                </div>
              </>
            )}
          </div>
          {messaging}
        </div>
        <PrivacySummary />
      </main>
    </>
  );
}
