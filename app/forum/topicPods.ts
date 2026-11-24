/**
 * The six pods on a topic's own page (WC-205), in Dane's order: what each one
 * is for, and why it is empty today. Nothing in WaveCenter links to a topic
 * yet (Forum threads and posts are not built; tasks and proposals have no
 * topic field), so every pod says why it is empty rather than showing a blank
 * (engineering rule 7). Dane chose "page first" on WC-205: the links that fill
 * these pods come as their own tickets. A plain module with its own test
 * (topicPods.test.ts), so the order and the wording are checked.
 */

export interface TopicPod {
  /** A short key, used for the pod's id on the page. */
  key: "discussion" | "featured" | "development" | "participation" | "reporting" | "proposals";
  title: string;
  /** What the pod will show once its data is linked to topics. */
  purpose: string;
  /** Why it is empty today, in one plain sentence. */
  emptyBecause: string;
}

export const TOPIC_PODS: readonly TopicPod[] = [
  {
    key: "discussion",
    title: "Discussion",
    purpose: "Every Forum thread about this topic.",
    emptyBecause: "No threads yet: Forum threads have not been built.",
  },
  {
    key: "featured",
    title: "Featured content",
    purpose: "New and popular posts and commentary about this topic, linked.",
    emptyBecause: "No posts yet: Forum posts have not been built.",
  },
  {
    key: "development",
    title: "Development",
    purpose: "The most recent and most important tasks for this topic; choose one to see its key details and a link to its page.",
    emptyBecause: "No tasks are linked to topics yet: a task has no topic field.",
  },
  {
    key: "participation",
    title: "Participation",
    purpose: "Recent activity on WaveCenter about this topic, and the members engaging with it.",
    emptyBecause: "No activity is recorded against topics yet, so there is no one to list.",
  },
  {
    key: "reporting",
    title: "Reporting",
    purpose: "Numbers for this topic, such as the tasks finished and the discussion it has drawn.",
    emptyBecause: "Nothing to count yet: no tasks, threads or proposals are linked to topics.",
  },
  {
    key: "proposals",
    title: "Proposals",
    purpose: "Every proposal about this topic.",
    emptyBecause: "No proposals are linked to topics yet: a proposal has no topic field.",
  },
];
