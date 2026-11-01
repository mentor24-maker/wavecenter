import Link from "next/link";
import type { TasksView } from "./evolutionView";

/** The Tasks page's views, in switch order. The list is the default. */
const VIEWS = [
  { key: "list", href: "/tasks", label: "List" },
  { key: "evolution", href: "/tasks?view=evolution", label: "Evolution" },
] as const;

/** The List | Evolution switch beside the Tasks heading; the view you are on is marked as the current page. */
export default function ViewSwitch({ current }: { current: TasksView }) {
  return (
    <nav className="view-switch" aria-label="Tasks view">
      {VIEWS.map((v) => (
        <Link key={v.key} href={v.href} aria-current={v.key === current ? "page" : undefined}>
          {v.label}
        </Link>
      ))}
    </nav>
  );
}
