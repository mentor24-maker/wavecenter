"use client";

/**
 * The profile form. It says "Saved" only when the server reports the
 * database took the save, and then shows what the database holds. A failed
 * save shows why, keeps what was typed so nothing is lost, and says plainly
 * that it was not saved (engineering rule 6).
 */
import { useState, useTransition, type FormEvent } from "react";
import {
  AVATARS, BIO_MAX, DISPLAY_NAME_MAX, PROFILE_VISIBILITIES, type MemberProfile, type ProfileVisibility,
} from "../../core/profiles.ts";
import { saveMyProfile } from "./actions";

const VISIBILITY: Record<ProfileVisibility, { label: string; means: string }> = {
  anonymous: { label: "Anonymous", means: "Nobody sees anything but your avatar. Every profile starts here." },
  private: { label: "Private", means: "Only you see your name and bio." },
  public: {
    label: "Public",
    means: "Other signed-in members can see your name and bio, once WaveCenter has a page that shows other members.",
  },
};

const UNREACHABLE =
  "Could not reach WaveCenter, so your profile was not saved. Check your connection and try again; what you typed is still here.";

export default function ProfileForm({ initial }: { initial: MemberProfile }) {
  const [displayName, setDisplayName] = useState(initial.displayName ?? "");
  const [avatar, setAvatar] = useState<string>(initial.avatar);
  const [bio, setBio] = useState(initial.bio ?? "");
  const [visibility, setVisibility] = useState<string>(initial.visibility);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await saveMyProfile({ displayName, avatar, bio, visibility });
        if (result.ok) {
          setDisplayName(result.profile.displayName ?? "");
          setAvatar(result.profile.avatar);
          setBio(result.profile.bio ?? "");
          setVisibility(result.profile.visibility);
          setMessage({ ok: true, text: "Saved." });
        } else {
          setMessage({ ok: false, text: `Not saved. ${result.error}` });
        }
      } catch {
        setMessage({ ok: false, text: UNREACHABLE });
      }
    });
  }

  const edited = () => setMessage((m) => (m?.ok ? null : m));

  return (
    <form className="stack profile" onSubmit={submit}>
      <label htmlFor="display-name">Display name</label>
      <input
        id="display-name"
        value={displayName}
        maxLength={DISPLAY_NAME_MAX}
        placeholder="Leave blank to stay nameless"
        onChange={(e) => { setDisplayName(e.target.value); edited(); }}
      />

      <fieldset>
        <legend>Avatar</legend>
        <div className="avatars">
          {AVATARS.map((a) => (
            <label key={a.id} className={avatar === a.id ? "avatar chosen" : "avatar"} title={a.label}>
              <input
                type="radio"
                name="avatar"
                value={a.id}
                checked={avatar === a.id}
                onChange={() => { setAvatar(a.id); edited(); }}
              />
              <span aria-hidden="true">{a.symbol}</span>
              <span className="sr-only">{a.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label htmlFor="bio">Short bio</label>
      <textarea
        id="bio"
        rows={3}
        value={bio}
        maxLength={BIO_MAX}
        placeholder="Optional"
        onChange={(e) => { setBio(e.target.value); edited(); }}
      />

      <fieldset>
        <legend>Who can see your profile</legend>
        {PROFILE_VISIBILITIES.map((v) => (
          <label key={v} className="choice">
            <input
              type="radio"
              name="visibility"
              value={v}
              checked={visibility === v}
              onChange={() => { setVisibility(v); edited(); }}
            />
            <span>
              <b>{VISIBILITY[v].label}</b>: {VISIBILITY[v].means}
            </span>
          </label>
        ))}
      </fieldset>

      <button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
      {message && (
        <p className={message.ok ? "note" : "error"} role={message.ok ? "status" : "alert"}>{message.text}</p>
      )}
    </form>
  );
}
