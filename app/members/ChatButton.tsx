"use client";

/**
 * The Chat button in a member's row: a speech bubble that finds or starts
 * your chat with them (startChatWith, on the server) and opens it at
 * `/chat/<id>`. Clicking it again opens the same chat. A failure says why
 * beside the button and opens nothing (engineering rule 6).
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { startChatWith } from "../chat/actions";

const UNREACHABLE = "Could not reach WaveCenter, so no chat was started. Check your connection and try again.";

export default function ChatButton({ memberId, label }: { memberId: string; label: string }) {
  const router = useRouter();
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function open() {
    setFailure(null);
    startTransition(async () => {
      try {
        const result = await startChatWith(memberId);
        if (!result.ok) {
          setFailure(result.error);
          return;
        }
        router.push(`/chat/${result.id}`);
      } catch {
        setFailure(UNREACHABLE);
      }
    });
  }

  return (
    <>
      <button type="button" className="icon-button" aria-label={`Chat with ${label}`} title="Chat" onClick={open} disabled={pending}>
        <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M4 5h16v11H9l-5 4z" />
        </svg>
      </button>
      {failure && <span className="error chat-start-error" role="alert">{failure}</span>}
    </>
  );
}
