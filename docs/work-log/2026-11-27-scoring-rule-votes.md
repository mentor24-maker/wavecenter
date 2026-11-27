## 2026-11-27 — Let members vote on what each game action is worth (#222)

Until now, only an admin decided what each game action is worth: making a
task, finishing one, voting on one, and so on. The DEO whitepaper says
members should set these values together, by voting, so that over time each
action settles at its natural worth. This change is the first step toward
that.

On the Game page, the "How points are earned" table now shows three things
on every action's row:

- **Admin's value**: what the action earns today.
- **Members' average**: the average of everyone's votes, or "No votes yet".
- **Your vote**: your own number, which you can type in, change or withdraw.

Each member gets one vote per action, and voting again changes it. Every
member can see the votes, but only you can change yours, and the database
itself enforces that.

The votes are **collected and shown, but they do not count yet**. Every
action still earns the admin's value, and nobody's earned points change.
How the votes should count (for example, averaged with the admin's value)
is Dane's decision for a later ticket.
