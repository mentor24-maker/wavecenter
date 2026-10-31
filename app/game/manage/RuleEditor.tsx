"use client";

/**
 * One scoring rule as a small form (name, description, criteria, points), or
 * with no rule, the form that adds a new action. It says "Saved" only when
 * the server reports the database took the change; a failed save keeps what
 * was typed and says plainly that nothing was saved (engineering rule 6).
 * The browser's own checks are off (noValidate) so a bad value gets
 * WaveCenter's plain message, the same one core and the database give.
 */
import { useState, useTransition } from "react";
import type { ScoringRule } from "../../../core/game.ts";
import { addScoringAction, saveScoringRule, type RuleForm } from "./actions";

const UNREACHABLE = "Could not reach WaveCenter, so nothing was saved. Check your connection and try again.";
const BLANK: RuleForm = { name: "", description: "", criteria: "", points: "1" };

function formOf(rule: ScoringRule): RuleForm {
  return { name: rule.name, description: rule.description, criteria: rule.criteria, points: String(rule.points) };
}

export default function RuleEditor({ rule }: { rule?: ScoringRule }) {
  const [form, setForm] = useState<RuleForm>(rule ? formOf(rule) : BLANK);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const id = rule ? `rule-${rule.kind}` : "rule-new";
  const set = (part: keyof RuleForm) => (e: { target: { value: string } }) => {
    setForm({ ...form, [part]: e.target.value });
    setMessage(null);
  };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    startTransition(async () => {
      try {
        const result = rule ? await saveScoringRule(rule.kind, form) : await addScoringAction(form);
        if (result.ok) {
          setForm(rule ? formOf(result.rule) : BLANK);
          setMessage({ ok: true, text: rule ? "Saved." : `Added "${result.rule.name}". It is listed above, not active yet.` });
        } else {
          setMessage({ ok: false, text: `Not saved. ${result.error}` });
        }
      } catch {
        setMessage({ ok: false, text: UNREACHABLE });
      }
    });
  }

  return (
    <form className="rule-form" onSubmit={submit} noValidate aria-label={rule ? `Change ${rule.name}` : "Add a new action"}>
      <div className="rule-line">
        <label className="grow">
          Name
          <input value={form.name} onChange={set("name")} maxLength={80} required disabled={pending} />
        </label>
        <label className="points">
          Points
          <input type="number" min={0} step={1} inputMode="numeric" value={form.points} onChange={set("points")} disabled={pending} />
        </label>
      </div>
      <label htmlFor={`${id}-description`}>Description</label>
      <textarea id={`${id}-description`} value={form.description} onChange={set("description")} maxLength={500} rows={2} disabled={pending} />
      <label htmlFor={`${id}-criteria`}>What counts</label>
      <textarea id={`${id}-criteria`} value={form.criteria} onChange={set("criteria")} maxLength={500} rows={2} disabled={pending} />
      <p>
        <button type="submit" disabled={pending}>{rule ? "Save" : "Add action"}</button>{" "}
        {pending && <span className="note">Saving…</span>}
      </p>
      {message && (
        <p className={message.ok ? "note" : "error"} role={message.ok ? "status" : "alert"}>{message.text}</p>
      )}
    </form>
  );
}
