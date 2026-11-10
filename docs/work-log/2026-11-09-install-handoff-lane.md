## 2026-11-09 — Install the hand-off lane so member-ticked tasks reach the queue again (#159)

When a member ticks a task for AI agents, the hand-off lane is the helper on
the Mac Mini that files it into the queue. Moving to Spirality's loop left it
switched off, because the tracker had no sign-in for it. Spirality has since
added a way for a project to name lanes of its own, and this change uses it.
WaveCenter's settings now name the hand-off lane, so it gets a sign-in of its
own. The installer runs it next to the other lanes, waking every 10 minutes,
and it stops any single pass that runs longer than 15 minutes.

Two smaller fixes went with it. WaveCenter's own task commands were not
reading the new sign-in list, so they would still have turned the lane away.
And one refused sign-in used to stop the whole "bring finished tickets back"
step. Now that one task is marked as failed and the step carries on with the
rest.

Two steps remain after the merge, both run on the Mini: make the lane's
sign-in (one command that writes it straight into Doppler), then rerun the
installer.
