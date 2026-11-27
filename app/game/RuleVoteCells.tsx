"use client";

/**
 * The two vote cells of one row in the Game page's "How points are earned"
 * table: the members' average ("No votes yet" when nobody has voted), and the
 * signed-in member's own vote, with a box to cast or change it and a way to
 * withdraw it. The save goes through the server action `voteOnRule`; a vote
 * the database did not take says "Not saved" and why, never "Saved"
 * (engineering rule 6). A vote changes nothing an action earns: that is
 * still the admin's value.
 */
import { useState, useTransition, type FormEvent } from "react";
import type { ScoringRuleVoteSummary } from "../../core/game.ts";
import { voteOnRule } from "./actions";

const UNREACHABLE = "Could not reach WaveCenter, so your vote was not saved. Check your connection and try again.";

type Message = { ok: boolean; text: string } | null;

export default function RuleVoteCells({ kind, name, summary: stored }: { kind: string; name: string; summary: ScoringRuleVoteSummary }) {
  const [summary, setSummary] = useState(stored);
  const [typed, setTyped] = useState(stored.mine === null ? "" : String(stored.mine));
  const [message, setMessage] = useState<Message>(null);
  const [pending, startTransition] = useTransition();

  function send(value: string | null) {
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await voteOnRule(kind, value);
        if (!result.ok) {
          setMessage({ ok: false, text: `Not saved. ${result.error}` });
          return;
        }
        setSummary(result.summary);
        setTyped(result.summary.mine === null ? "" : String(result.summary.mine));
        setMessage({ ok: true, text: result.summary.mine === null ? "Your vote is withdrawn." : "Saved." });
      } catch {
        setMessage({ ok: false, text: UNREACHABLE });
      }
    });
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!typed.trim()) {
      setMessage({ ok: false, text: "Type a whole number from 0 up to vote, or use Withdraw to take your vote back. Nothing was saved." });
      return;
    }
    send(typed);
  }

  return (
    <>
      <td className="num vote-gap">
        {summary.average === null ? (
          <span className="note">No votes yet</span>
        ) : (
          <>
            <b>{summary.average}</b>
            <span className="note block">
              {summary.voters} {summary.voters === 1 ? "vote" : "votes"}
            </span>
          </>
        )}
      </td>
      <td className="vote-gap">
        <span className="block">{summary.mine === null ? <span className="note">You have not voted</span> : <>Your vote: <b>{summary.mine}</b></>}</span>
        <form className="rule-vote" onSubmit={onSubmit} noValidate>
          <input
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            aria-label={`Your vote on what "${name}" is worth`}
            disabled={pending}
          />
          <button type="submit" disabled={pending}>Vote</button>
          {summary.mine !== null && (
            <button type="button" className="link" disabled={pending} onClick={() => send(null)}>
              Withdraw<span className="sr-only"> your vote on "{name}"</span>
            </button>
          )}
        </form>
        {message && (
          <p className={message.ok ? "note" : "error"} role={message.ok ? "status" : "alert"}>{message.text}</p>
        )}
      </td>
    </>
  );
}
