## 2026-11-26 — Make the task permissions in roles actually decide what members do (#220)

Each role has had task permissions (read, create, edit, delete) since
October, but they were only shown on the Members page: every member could
read every task, and change and delete only their own, whatever their role.
Now the permissions decide it, both in the database's own rules and in
WaveCenter's core rules, so a client that goes around the app cannot get
past them either.

- **Admins and editors** change and delete anyone's task. Two new
  permissions make that possible: *Edit anyone's task* and *Delete anyone's
  task*.
- **Contributors** add tasks and change and delete their own, as before.
- **Reviewers and viewers** only read. Pressing Add as a viewer now says
  "Your role may not add tasks. Nothing was added." instead of saving.
- **Points stay the owner's.** Even an admin cannot change another member's
  task's points, so the owner's own score is never overwritten; votes and
  the AI rating still count. Nobody can hand a task to a different owner.

One limit for now: an editor cannot delete another member's task that has
files attached, because only whoever attached a file may delete it from
storage. The app says so and deletes nothing.

Next (WC-254): the tasks screen hides the controls a role may not use, so a
viewer no longer sees the Add task box at all.
