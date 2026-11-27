/**
 * What a topic's own page and its edit page both need: the signed-in member,
 * the header, every topic (for the parent's name and the Parent dropdown),
 * the one asked for, and its tags with every tag it could carry (WC-249). Read through the member's own session, so row-level
 * security decides what comes back. Every way it can fail comes back as a
 * plain-words reason for the page to show, never an empty screen (rule 7).
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { entriesByName, mayChangeTopic, type ForumActor, type ForumTopic } from "../../../core/forum.ts";
import { headerPoints, type HeaderPoints } from "../../lib/engagementStore";
import { listTags, listTopics, listTopicTags } from "../../lib/forumStore";
import { headerName } from "../../lib/memberProfileStore";
import { headerIsAdmin } from "../../lib/memberRoleStore";
import { currentUser, SIGN_IN_CHECK_FAILED, supabaseForRequest } from "../../lib/supabase";
import SiteHeader from "../../SiteHeader";
import { forumNamer } from "../forumNames";

/** A topic id is a UUID; anything else cannot be a topic, so it is not asked for. */
const TOPIC_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Header {
  name?: string | null;
  isAdmin?: boolean;
  points?: HeaderPoints;
}

/** A tag as the topic pages show it. */
export type TagChoice = { id: string; name: string };

/**
 * The topic's tags (WC-249): the ones it carries and every tag there is, both
 * A to Z; or why they could not be read, so the page never shows "No tags
 * yet" when it simply could not tell (rule 7).
 */
export type TopicTagsLoad = { ok: true; carried: TagChoice[]; all: TagChoice[] } | { ok: false; problem: string };

export type TopicLoad =
  | { ok: false; header: Header; problem: string; notFound?: true }
  | {
      ok: true;
      header: Header;
      topic: ForumTopic;
      topics: ForumTopic[];
      tags: TopicTagsLoad;
      mayChange: boolean;
      actor: ForumActor;
      namer: (id: string | null) => string;
    };

export async function loadTopic(id: string): Promise<TopicLoad> {
  const supabase = await supabaseForRequest();
  const { user, checkFailed } = supabase ? await currentUser(supabase) : { user: null, checkFailed: false };
  if (supabase && !user && !checkFailed) redirect("/sign-in");
  if (!supabase || !user) {
    return {
      ok: false,
      header: {},
      problem: !supabase ? "This copy of WaveCenter has no database settings, so there is no topic to show." : SIGN_IN_CHECK_FAILED,
    };
  }

  const isTopicId = TOPIC_ID.test(id);
  const [name, isAdmin, points, namer, read, tagRead] = await Promise.all([
    headerName(supabase, user),
    headerIsAdmin(supabase, user.id),
    headerPoints(supabase, user.id),
    forumNamer(supabase, user.id),
    listTopics(supabase).then(
      (topics) => ({ topics }),
      (err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }),
    ),
    isTopicId
      ? Promise.all([listTags(supabase), listTopicTags(supabase, { topicId: id })]).then(
          ([all, pairs]): TopicTagsLoad => {
            const choices = entriesByName(all, all.map((t) => t.id)).map((t) => ({ id: t.id, name: t.name }));
            return { ok: true, all: choices, carried: entriesByName(choices, pairs.map((p) => p.tagId)) };
          },
          (err: unknown): TopicTagsLoad => ({
            ok: false,
            problem: `This topic's tags could not be loaded: ${err instanceof Error ? err.message : String(err)}. Nothing has been lost; try reloading the page.`,
          }),
        )
      : Promise.resolve<TopicTagsLoad>({ ok: true, all: [], carried: [] }),
  ]);
  const header = { name, isAdmin, points };
  if ("error" in read) return { ok: false, header, problem: `This topic could not be loaded: ${read.error}. Nothing has been lost; try reloading the page.` };
  const topic = isTopicId ? read.topics.find((t) => t.id === id) : undefined;
  if (!topic) return { ok: false, header, notFound: true, problem: "This topic was not found. It may have been deleted, or the link may be wrong." };
  const actor = { memberId: user.id, isAdmin: Boolean(isAdmin) };
  return { ok: true, header, topic, topics: read.topics, tags: tagRead, mayChange: mayChangeTopic(topic, actor), actor, namer };
}

/** The page around a topic: the header, a way back to the Forum, and the content. */
export function TopicShell({ header, children }: { header: Header; children: ReactNode }) {
  return (
    <>
      <SiteHeader name={header.name} isAdmin={header.isAdmin} points={header.points} />
      <main>
        <p className="note">
          <Link href="/forum">← Back to the Forum</Link>
        </p>
        {children}
      </main>
    </>
  );
}
