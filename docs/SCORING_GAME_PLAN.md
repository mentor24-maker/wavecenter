# The scoring guess game: a project plan

**Status: a plan for Dane to read and decide on. Nothing here is built.**
Written 2026-11-01 for the ticket "Dane gets a project plan for the scoring
guess game: the human, AI and final scores, deviance and DQ, and the
sub-tasks to add" (WaveCenter task "Create the Game Layer scoring guess
game").

## What Dane asked for

Dane, 2026-11-01, in his own words:

> We are going to set up a system to determine the scores for every task that
> flows through the system as well as every action that takes place through
> the game layer. The idea is to set up AI to assess the appropriate score
> based on an algorithm that we will determine together. [...] We need to
> generate a human score based on the average of all the people who voted on
> it averaged with the owner's score. Then the final score for the task will
> be the average of the AI score and the Human score. We will then develop a
> game around this process, so people can see a task or game behavior and
> guess what they think the score should be. The difference between their
> guess and the actual score is called their 'deviance score' on that
> particular item. The normalized average of all the deviance scores for a
> given member is called their 'deviance quotient' or DQ.

A few words used below:

- **Score** means how many points something is worth. A task has one today
  (its `points`); each kind of action in the game layer has one too (its
  scoring rule).
- **The ledger** is the game layer's record of every action a member takes
  and the points it earned (the `engagements` table).
- **A table** is one list of records in the database, such as `tasks`.
- **Row-level security** is the database's own rule about who may read or
  change each record. Every new table turns it on when it is created
  (engineering rule 2).
- **Server** means the computer that runs WaveCenter, as opposed to the
  member's browser. Anything secret, such as the key to an AI service, stays
  on the server (engineering rule 3).

## What exists today

Read from the code on 2026-11-01.

### A task's points

- **The owner's suggested value.** The member who adds a task sets its
  points, a whole number from zero up. Every change goes through
  `setPoints` or `awardPoints` in `core/points.ts`. A finished (`done`)
  task's points are locked until it is reopened.
- **Members' votes replace it.** Any signed-in member may vote on what a task
  is worth (`core/votes.ts`; the `task_votes` table, made in
  `supabase/migrations/20261028140000_task_votes.sql`). The task's points
  become the **plain average of the votes**, rounded to the nearest whole
  number with a half rounding up. From the first points vote on, **the
  owner's own number no longer counts at all**: it is not part of the
  average, and the owner may not type over it (`requireNotVotedOn`). The
  database works the average out itself in the same save as the vote
  (`task_votes_apply`), following `votedValues` in `core/votes.ts` exactly.
- **Two side effects worth knowing.** The task keeps only one number, so once
  votes come in, the owner's original suggestion is overwritten and gone.
  And if every member later withdraws their vote, the task keeps the last
  average; it does not go back to the owner's suggestion.
- **A member's finished-task score.** `scoreFinishedTasks` in `core/score.ts`
  adds up the points of a member's finished tasks. The Game page (`/game`,
  `app/game/page.tsx`) shows it.

### The game layer's actions

- **Every action is already scored.** `core/game.ts` lists ten kinds of
  action (made a task, finished a task, voted on a task, and so on), and the
  database records one ledger entry each time a member does one
  (`supabase/migrations/20261027120000_game_layer.sql`). Each entry copies its
  points from the scoring rule at that moment.
- **An admin sets what each action is worth.** On the Game management screen
  (`/game/manage`, `app/game/manage/`), through `changeScoringRule` and
  `addScoringRule` (`supabase/migrations/20261031140000_game_scoring_admin.sql`).
  There is no member vote and no AI score on actions yet.
- **The two kinds of points are separate.** What a task is worth and what a
  member has earned in the ledger are not added together anywhere.

### The Game pages

`/game` (My Points) shows the member's ledger total, finished tasks and the
scoring rules. `/game/leaderboard` is a placeholder saying it is not built
yet. `/game/manage` is the admin's rule editor. Nothing shows a guess, a
deviance score or a DQ.

## The scores, as Dane described them

For every task:

1. **Owner's score.** The owner's suggested points, as today.
2. **Human score.** The members' votes averaged with the owner's score.
   There are two ways to read "averaged with"; see question 1.
3. **AI score.** What an AI assessment says the task is worth, by an
   algorithm still to be agreed (see "The AI score" below).
4. **Final score.** The average of the AI score and the human score. This is
   the task's points: the number on the task list, the one a finished task
   adds to its owner's score, and the "actual score" the guess game measures
   against.

**This changes today's rule.** Today the members' average *replaces* the
owner's points. Under Dane's new rule the owner's score always counts, as
part of the human score, and the human score is only half of the final
score. Sub-task 2 makes that change; sub-task 1 has to come first, because
today the owner's number is overwritten and could not be averaged in.

Until an AI score exists for a task, the plan proposes the final score is the
human score alone, and the screen says so ("AI score: not yet"), so a task is
never stuck at no score (question 3 asks Dane to confirm).

A worked example, reading A of question 1: the owner suggests 10; three
members vote 4, 6 and 8 (average 6). Human score = (10 + 6) ÷ 2 = 8. The AI
says 12. Final score = (8 + 12) ÷ 2 = 10.

## The same scoring for game behaviors

Dane's notes say the system scores "every action that takes place through
the game layer", not only tasks. Today an action's worth is one number per
kind, set by an admin. The same four parts can apply:

- **Owner's score** becomes the admin's value on the scoring rule.
- **Human score** comes from members voting on what each kind of action is
  worth. This is the canon's "continuously voted valuation repository"
  (*White Paper*, "Engagement and Intelligence"), and `docs/DATA_MODEL.md`
  already lists it under "How this grows".
- **AI score** and **final score** work as for tasks. For these granular
  kinds of action (`docs/DATA_MODEL.md`, "Granular and globular scores"),
  the AI score is the algorithm in `docs/GRANULAR_SCORING_ALGORITHM.md`,
  drafted by Claude for Dane to approve.

Whether this is scored per *kind* of action ("voted on a task" is worth N)
or per *individual* action ("this particular vote" is worth N) is question 7.
Per kind is far smaller and matches how the ledger works today.

As today, a change to an action's score counts from the next entry; points
already earned keep what they were given.

## The guess game

1. A member is shown a task, or a game behavior, and guesses its score.
2. Once the item's final score is settled, their **deviance score** on it is
   the difference between the guess and the final score. A guess of 7 on a
   10-point task has a deviance of 3, whether 3 under or 3 over.
3. A member's **deviance quotient (DQ)** is the normalized average of all
   their deviance scores. "Normalized" means put on a common scale so a
   miss on a small task and a miss on a big one can be compared fairly; how
   is question 2. A low DQ means the member reads the scoring system well.

Open design points the plan does not settle (each is a question below):

- **When a guess settles.** The final score can move as votes come in and
  the AI score arrives, so a deviance worked out today could be wrong
  tomorrow (question 4).
- **What a guesser may see first.** If the votes and the current score are
  visible, a guess is just copying them (question 5).
- **Whether guessing earns ledger points**, and whether DQ ever counts toward
  anything, such as a member's voting weight later (question 6).

## The AI score

- **Where it runs.** On the server only, never in the browser. The key to
  any AI service lives in Doppler and the server's settings, never in the
  page (engineering rule 3). It uses an ordinary call to an AI service's
  public API from WaveCenter's own server code, which works on any host, not
  a Vercel-only feature (engineering rule 11).
- **What it would read.** The task's title and details, its sub-tasks, its
  files' names, and the scoring rules, so it judges against the same scale
  as the members. It does not read anyone's private profile data.
- **How it is kept accountable.** The canon says the DEO "holds the AI
  accountable through multi-model consensus, auditable parameters, and the
  standing rule of human primacy over every automated decision"
  (`docs/canon/deo-whitepaper.md`, "Operations and Infrastructure"). For
  this plan that means:
  - **Multi-model consensus:** the AI score can be the average of more than
    one AI model's answer, not one model's word.
  - **Auditable parameters:** every AI score is saved with which model gave
    it, which version of the instructions it was given, what it read, and its
    stated reasons, so any member can check how a number was reached.
  - **Human primacy:** the AI score is never more than half the final score,
    and question 3 asks how a human can override one.
- **The algorithm itself is a joint decision still to come.** Dane said
  "an algorithm that we will determine together". Sub-task 3 is that
  conversation, written down as a design document for Dane to approve; no
  AI scores anything until he has.

## Sub-tasks, in build order

Each is sized as one pull request, with the plain-words title it would carry
as a ticket. Dane adds them under this task (or asks a `loop-spec` session to
file them) once he has read this plan. Every new table named below turns on
row-level security in the same migration that creates it (engineering rule 2).

1. **"The owner's suggested points disappear once members vote: keep the
   owner's, the human, the AI and the final score separately"**
   Goal: a new table, `task_scores` (one row per task: owner's score, human
   score, AI score, final score), with row-level security on from creation;
   the task's `points` stays the final score so every screen keeps working.
   Today's rule is unchanged in this step.
2. **"Dane's human score: members' votes averaged with the owner's score
   decide a task's points"**
   Goal: change `votedValues` in `core/votes.ts` and the database's
   `task_votes_apply` to the formula Dane picks in question 1. **This is the
   sub-task that ends "the votes' average replaces the owner's points".**
   The owner may set their suggestion again after votes; it is one part of
   the human score.
3. **"Dane and Claude agree how the AI scores a task: a written design to
   approve"**
   Goal: a design document (no code): what the AI reads, the instructions it
   is given, which models and how many, how its reasons are recorded, and
   how a human overrides it. Dane approves it before sub-task 5.
4. **"Members can see a task's human, AI and final score, with the AI score
   marked not yet"**
   Goal: the task's page shows the four parts and how the final score was
   worked out; with no AI score, final = human score and the screen says so.
5. **"The AI scores each task on the server, and every score shows its
   reasons"**
   Goal: the approved design, live: a server-only job writes the AI score
   with its model, instruction version and reasons into a record any member
   can read. The key never reaches the browser.
6. **"Members can vote on what each game action is worth, and it counts in
   that action's score"**
   Goal: votes on the scoring rules (a new table with row-level security),
   giving each kind of action an owner's (admin), human, AI and final score,
   by the same formula as tasks.
7. **"Members can guess what a task or game action is worth"**
   Goal: a `score_guesses` table (row-level security on from creation; a
   member sees only their own guesses until they settle) and a Guess screen
   in the Game menu that hides the current score until the member has
   guessed.
8. **"Each settled guess shows the member how far off it was"**
   Goal: when an item's score settles (question 4), each guess on it gets its
   deviance score, saved and shown to the guesser.
9. **"Members see their DQ on their profile and the Game page"**
   Goal: `core/` works out a member's DQ from their deviance scores (by the
   normalization in question 2); Your profile and My Points show it, and say
   why when there is none yet.
10. **"The leaderboard shows members' points and DQ instead of a 'not built
    yet' sentence"**
    Goal: build `/game/leaderboard`, ranking members by points and showing
    each one's DQ, respecting who has chosen to show their name.

Sub-tasks 1, 2 and 4 can be built while the AI design (3) is discussed. The
guess game (7 to 10) does not need the AI live: it can measure guesses
against the final score whatever it is made of.

## Questions for Dane

1. **How is the human score worked out?** "The average of all the people
   who voted on it averaged with the owner's score" can mean two things.
   Example: owner says 10; three members vote 4, 6 and 8.
   - **A. Half and half.** The owner's score and the voters' average weigh
     half each: (10 + 6) ÷ 2 = **8**. The owner always carries half, however
     many vote.
   - **B. The owner is one more voter.** (10 + 4 + 6 + 8) ÷ 4 = **7**. The
     owner's weight shrinks as more members vote.
2. **What does "normalized" mean for DQ?**
   - **A. Relative to the item's size.** Each deviance is divided by the
     final score, so missing a 4-point task by 2 (50%) counts more than
     missing a 40-point task by 2 (5%). A 0-point item needs a rule of its
     own.
   - **B. A 0 to 100 scale.** The average deviance is turned into a number
     from 0 to 100 (for example, 100 for a perfect guesser), easy to read on
     a leaderboard.
   - **C. Both.** A worked out as in A, then shown on the 0 to 100 scale of
     B.
3. **How do we decide the AI algorithm, and how does a human overrule it?**
   - **A. Design document first** (sub-task 3): Claude drafts it, Dane
     approves it, and only then does the AI score anything.
   - **B. Try and tune.** Run a simple first version on past tasks without
     it counting, compare with members' votes, then agree the rules.
   And, for overruling: **(i)** an admin may replace one AI score, with a
   reason on record; **(ii)** members vote to reject one; **(iii)** no
   override beyond it being half the final score. Also: until a task has an
   AI score, is the final score the human score alone (the plan's proposal)?
4. **When does a guess settle?**
   - **A. When the task is done** and its points lock.
   - **B. After a set time**, such as seven days, with the score as it then
     stands.
   - **C. At once**, against the score at the moment of guessing.
   For game actions (which are never "done"), A cannot apply, so B or C.
5. **What may a member see before guessing, and who may guess?**
   - **A. Hidden until you guess.** The votes and current score are hidden
     from a member until they have guessed (or chosen to skip).
   - **B. Everything visible.** Simpler, but a guess can just copy the
     current score.
   And may a task's owner, or a member who voted on it, guess on it?
6. **Does guessing count in the game?**
   - **A. Yes, a ledger action** ("Guessed a score"), worth points like any
     other action.
   - **B. No points**; DQ is its own measure.
   - **C. Points that depend on how close the guess was.**
   And should DQ later count toward a member's voting weight or reputation?
7. **Are game behaviors scored per kind or per individual action?**
   - **A. Per kind.** "Voted on a task" has one score; matches today's
     scoring rules.
   - **B. Per individual action.** Each single vote, comment or file has its
     own score; far more to vote and guess on.
8. **Rounding.** Today scores are whole numbers, a half rounding up. Keep
   that for the human, AI and final scores (the plan's proposal), or allow
   decimals?
