# Operator prompts

Every prompt Dane gives an agent session about WaveCenter, word for word, and
what each one led to: tickets, pull requests, doc sections, saved memories and
decisions. His prompts are the seed of everything the loop builds, so they are
kept here rather than only in the chat thread where they were typed. One
section per thread, newest at the bottom. Earlier sections are history and
stay as written; only a broken link gets corrected. Material Dane pasted in
(a log, an email) is named in square brackets, not copied. Times are
Mountain time.

## 2026-11-04 to 2026-11-09: AI rating moves to the Mac Mini

1. "re: 86bcxu6vp, We need to adjust this feature so it uses the monthly
   Anthropic account instead of API quota. We should be able to handle this in
   the same way we handle tickets. Describe how that process will work."

   Led to: a plan for a fifth Mac Mini lane that rates tasks through headless
   Claude Code under Dane's plan instead of the website calling the Anthropic
   API. No change yet.

2. "go with the Mini"

   Led to: Dane's decision. The spec of
   [86bcxu6vp](https://app.clickup.com/t/86bcxu6vp), "The AI rates each task's
   factors on the server, with reasons", was rewritten for the Mini lane, and
   the credit request on it was withdrawn. It was built as
   [PR #149](https://github.com/mentor24-maker/wavecenter/pull/149) (same
   title, merged 2026-11-04) and written into
   [INFRASTRUCTURE.md](INFRASTRUCTURE.md) ("The AI that rates tasks") and
   [LOOP_ENGINEERING.md](LOOP_ENGINEERING.md) ("The AI rating lane"). Saved
   to agent memory as `ai-rating-on-mini`.

3. "replied to the clickup ticket"

   Led to: his reply "go with the Mini" on 86bcxu6vp (2:28 PM), which the
   merge lane carried out by moving the ticket back to Queued.

4. "On Project: Settings, change the save button to the standard green and
   reduce width from full-width, per our coding conventions. In addition, scan
   the entire application for any other key buttons (e.g. Save) that are still
   using any other colors and update them to the same style. Ensure that we
   are consolidating these styles in a standardized way to improve efficiency
   and ensure consistency."

   Led to: nothing in WaveCenter. WaveCenter has no Project Settings screen,
   and its buttons already share one teal style in `app/globals.css`. The
   request was StarCaster work (prompt 5). Nothing yet.

5. "starcaster" and "I pasted it in the wrong window. This is Starcaster"
   (his answers to the questions on prompt 4)

   Led to: nothing filed. StarCaster work belongs in StarCaster's own Loop
   Queue, so he was pointed to his StarCaster window.

6. "I have set up strands.starcaster.pro in project settings for Strands
   movie. Need instructions to set it up at DNS."

   Led to: an answer for StarCaster. A `*.starcaster.pro` address needs no
   DNS record (the zone is on Vercel with a wildcard), only the address
   added to StarCaster's Vercel project. By 2026-11-09 the address was
   loading. Nothing in WaveCenter.

7. "/close-check"

   Led to: a check of every item above.

8. "/doc-it"

   Led to: this log, ticket [86bd0w6rv](https://app.clickup.com/t/86bd0w6rv),
   "Dane's chat prompts live only in threads: start a prompt log", and a
   pointer to this log in `CLAUDE.md`.
