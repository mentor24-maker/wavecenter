# Ten ideas for the WaveCenter home page

Written 2026-10-30 for the ticket "Dane wants 10 ideas for what the WaveCenter
home page could show visitors" (https://app.clickup.com/t/86bcv32xh).

"Home page" here means the page a visitor sees at WaveCenter's front door
before logging in (the `Home` component in `app/page.tsx`), which today shows
a short paragraph and a Log in button. Each idea is tagged **built today**
(it shows something the code already has, and names that screen) or **coming
next** (it points at the path ahead, and names the passage it comes from).

Dane chose to go ahead without the spreadsheet attached to his WaveCenter
task (his answer "B" on the ticket, 2026-10-29), so the "coming next" ideas
draw only on `docs/MISSION.md` and `CLAUDE.md`. Nothing here is built yet;
building any idea is its own ticket once Dane picks.

---

1. **What WaveCenter is, in one breath** — *built today*
   A short headline and two sentences at the very top: WaveCenter is the hub
   of the DEO movement, and a DEO is an organization where people's
   engagement, not invested money, is what it runs on. The signed-out page
   (`app/page.tsx`, `Home`) already says this in a paragraph; this idea makes
   it the first thing anyone reads, so a newcomer knows where they are
   before anything else.

2. **What a member can do today** — *built today*
   A small tour of the task list a member gets after logging in: add tasks
   and sub-tasks, comment on them, attach files and pictures, and vote on
   what any task is worth and how urgent it is (`app/page.tsx` `YourTasks`,
   `app/tasks/`, `app/tasks/[id]/`). A screenshot or three short lines would
   do. It turns "coming soon" into "here is what is already working".

3. **How points are earned** — *built today*
   The scoring rules table, shown to visitors: making a task is 1 point,
   finishing one is 5, voting on a task is 1, and so on (the "How points are
   earned" table on the Game page, `app/game/page.tsx`, from
   `core/game.ts`). It shows in one glance the DEO's central promise, that
   every act of engagement is captured, valued and credited.

4. **AI agents help; people decide** — *built today*
   A short explanation that a member can tick a task and switch on "Launch
   AI Agents" to hand it to AI agents, which build it and send it back for a
   person to approve (the switch and AI tick boxes in `app/tasks/TaskList.tsx`).
   It matches the mission's "Integrated AI helps the members and never
   replaces them" (`docs/MISSION.md`, "What a DEO is"), and shows something
   most visitors have not seen before.

5. **Your data, your name** — *built today*
   A line saying that members are anonymous by default and choose what name,
   picture and bio others see, and who may see them (`app/profile/`, and
   the Members list honouring those choices in `app/members/`). It answers
   a visitor's first worry about signing up anywhere, and it is the mission's
   "Data sovereignty" commitment (`docs/MISSION.md`).

6. **Signs of life: what members have done so far** — *built today*
   A few running counts, such as tasks made, tasks finished, votes cast and
   points earned across all members, drawn from the tasks, votes and points
   records the Game and Tasks pages already read. It tells a visitor this
   place is active, not a placeholder. (A visitor who is not logged in
   cannot read those records today, by design, so this needs a safe
   summary that shows totals only, never anyone's details.)

7. **Where we are on the path** — *coming next*
   The five steps from the roadmap drawn as a simple line with a "you are
   here" marker: to-do list, then a project tool like ClickUp, then planning
   the bigger system, then the game layer, then inviting people in
   (`docs/MISSION.md`, "The trajectory"; `CLAUDE.md`, "What we are
   building"). A visitor sees both where WaveCenter is and where it is
   going.

8. **The season: Winter** — *coming next*
   One short box explaining that a DEO grows through four seasons and
   WaveCenter is in Winter: plans and code, no members yet beyond the
   founders; Spring is when members join and build part-time
   (`docs/MISSION.md`, the four seasons, "WaveCenter is in Winter"). It sets
   honest expectations and tells a visitor why now is an early, interesting
   time to watch.

9. **How to join: by invitation** — *coming next*
   A plain explanation that membership comes by invitation from a current
   member, who answers for the people they invite, and that every member is
   a real, single person (`docs/MISSION.md`, "Verified humans, by
   invitation"; `CLAUDE.md` step 5, "other people are invited in through the
   platform"). Until invitations exist, it can say "invitations open in
   Spring" in place of a button.

10. **Work waiting for you, with its points** — *coming next*
    A short list of open tasks that already carry a points value, as a taste
    of what a new member could pick up and what it would earn (`CLAUDE.md`
    step 5, "The plan is broken into tasks with defined points"; `docs/MISSION.md`,
    "Points are the seed of the game layer"). This is how the project
    bootstraps itself: the front door shows the work, and the work invites
    people in.
