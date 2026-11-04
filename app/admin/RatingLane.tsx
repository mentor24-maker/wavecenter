/**
 * "AI task ratings": what the AI rating lane on the Mac Mini did last
 * (scripts/rate_tasks.mjs). It shows the last pass's time, how many tasks it
 * rated, each it could not rate with the reason (nothing was saved for those,
 * engineering rule 6), and how many still wait. When no pass has run for over
 * an hour, or none ever has, it says plainly that the lane has stopped
 * (rule 7). There is no button: the website never calls the AI.
 */
import Link from "next/link";
import { RATING_LANE_INTERVAL_MINUTES, RATING_LANE_STOPPED_AFTER_MINUTES, ratingLaneState } from "../../core/aiTaskRater.ts";
import type { RatingPassReport } from "../lib/aiTaskRating";

const WHEN = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function ago(minutes: number): string {
  if (minutes < 1) return "just now";
  if (minutes < 120) return `${plural(minutes, "minute")} ago`;
  return `${plural(Math.floor(minutes / 60), "hour")} ago`;
}

export default function RatingLane({ pass, readError, now }: { pass: RatingPassReport | null; readError: string | null; now: Date }) {
  if (readError) {
    return <p className="error" role="alert">The AI rating lane&apos;s report could not be read: {readError} Try reloading the page.</p>;
  }
  const lane = ratingLaneState(pass, now);
  if (lane.state === "never" || !pass) {
    return (
      <p className="error" role="alert">
        The AI rating lane has never run, so no task has an AI rating yet. It runs on the Mac Mini every{" "}
        {RATING_LANE_INTERVAL_MINUTES} minutes once it is installed there (scripts/install_loop_runner.sh).
      </p>
    );
  }
  return (
    <>
      {lane.state === "stopped" ? (
        <p className="error" role="alert">
          The AI rating lane on the Mac Mini has stopped: its last pass was {ago(lane.minutesAgo)}, and it should run every{" "}
          {RATING_LANE_INTERVAL_MINUTES} minutes. No task is rated until it runs again (more than{" "}
          {RATING_LANE_STOPPED_AFTER_MINUTES} minutes means the Mini is off, asleep, or signed out of Claude).
        </p>
      ) : lane.passFailed ? (
        <p className="error" role="alert">
          The AI rating lane on the Mac Mini is running, but its last pass, {ago(lane.minutesAgo)}, failed and rated nothing. The reason is below.
        </p>
      ) : (
        <p className="note" role="status">The AI rating lane is running on the Mac Mini: last pass {ago(lane.minutesAgo)}.</p>
      )}
      <ul>
        <li>Last pass: {WHEN.format(new Date(pass.finishedAt))}{pass.signedInWith ? `, signed in to Claude with ${pass.signedInWith}` : ""}.</li>
        {pass.error ? (
          <li className="error">The whole pass failed, so it rated nothing: {pass.error}</li>
        ) : (
          <>
            <li>Rated: {plural(pass.rated, "task")}.</li>
            <li>Could not rate: {plural(pass.failed.length, "task")}{pass.failed.length ? `; nothing was saved for ${pass.failed.length === 1 ? "it" : "them"}` : ""}.</li>
            <li>
              Still waiting: {plural(pass.waiting, "task")}
              {pass.waiting ? ` (each pass rates at most 10; the next one takes them)` : ""}. Already up to date: {plural(pass.upToDate, "open task")}.
            </li>
          </>
        )}
      </ul>
      {pass.failed.length > 0 && (
        <>
          <h3>Not rated in the last pass</h3>
          <ul>
            {pass.failed.map((f) => (
              <li key={f.taskId}>
                <Link href={`/tasks/${f.taskId}`}>{f.title}</Link>: {f.reason}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
