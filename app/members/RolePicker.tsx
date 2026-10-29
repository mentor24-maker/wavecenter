"use client";

/**
 * One member's role, as a drop-down that saves as soon as it changes. It
 * says "Saved" only when the server reports the database took the change. A
 * failed save puts the drop-down back to the role the database still holds
 * and says plainly that nothing changed (engineering rule 6).
 */
import { useState, useTransition } from "react";
import { ROLES, type RoleKey } from "../../core/members.ts";
import { changeMemberRole } from "./actions";

const UNREACHABLE = "Could not reach WaveCenter, so the role was not changed. Check your connection and try again.";

export default function RolePicker({ memberId, initial, label }: { memberId: string; initial: RoleKey; label: string }) {
  const [role, setRole] = useState<RoleKey>(initial);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function change(next: string) {
    const before = role;
    setRole(next as RoleKey);
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await changeMemberRole(memberId, next);
        if (result.ok) {
          setRole(result.role);
          setMessage({ ok: true, text: "Saved." });
        } else {
          setRole(before);
          setMessage({ ok: false, text: `Not saved. ${result.error}` });
        }
      } catch {
        setRole(before);
        setMessage({ ok: false, text: UNREACHABLE });
      }
    });
  }

  return (
    <>
      <select aria-label={`Role for ${label}`} value={role} disabled={pending} onChange={(e) => change(e.target.value)}>
        {ROLES.map((r) => (
          <option key={r.key} value={r.key}>{r.name}</option>
        ))}
      </select>
      {pending && <span className="note block">Saving…</span>}
      {message && (
        <span className={message.ok ? "note block" : "error block"} role={message.ok ? "status" : "alert"}>{message.text}</span>
      )}
    </>
  );
}
