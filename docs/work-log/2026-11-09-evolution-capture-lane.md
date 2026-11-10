## 2026-11-09 — Merged changes get no Evolution picture: run the capture after merges (#158)

When WaveCenter moved to Spirality's loop, the job that merges pull requests
changed hands. WaveCenter's old merge job also took the Evolution picture of
each merged change for Home; Spirality's relay, which merges now, does not.
So merged changes stopped getting pictures.

The pictures now have their own small job on the Mac Mini, the Evolution
lane, which wakes every 10 minutes and pictures any change on `main` that has
none yet (and retakes old ones when the picture rules change), exactly as the
old merge job did after each merge. The installer sets it up again, along
with the headless browser it takes pictures with, and its status report says
whether that browser starts.

The picture code also learned to work with the new tracker. It finds each
change's ticket from the `Ticket:` line on its pull request, links the card
to the tracker's public page, reads Dane's words from the ticket (tracker
tickets fence them with `~~~`, which it did not read before), and posts a note
on the ticket when a picture fails. Tickets from the ClickUp days still read.
If picture-taking breaks for three passes in a row, the ticket it files for
Dane now goes into the tracker, not the old ClickUp list. Every note the
picture code writes on a ticket goes through Spirality's ticket door, the one
every other ticket write uses. It also recognises tickets with the new
`WC-<n>` names when it looks for the chat that made them.

One more fix, found in review: since 2026-11-03 every change with a screen
had failed to get its picture, because the styled password-reset email added
a template file the picture job never copied into its scratch copy of the
database setup. It copies it now; a retake of one of those changes (the Admin
link move) produced its picture again.

The lane starts once the installer is rerun on the Mini after this merges.
