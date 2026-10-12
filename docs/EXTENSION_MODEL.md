# How members' tools plug into WaveCenter

**Status: a proposal for Dane to decide. Nothing here is built.** Written
2026-10-11 for the ticket "Before others are invited in: decide how members'
tools plug into WaveCenter".

## The question

Dane's framing (2026-10-11): WaveCenter starts as a gamified to-do list,
becomes a project manager, then an extensible platform with a growing network
of tools, games, resources and communities, all built by DEO members.

Choosing Next.js decided how **one website** is built. It did not decide how
**other people's work** attaches to WaveCenter. That has to be settled before
anyone outside is invited in (roadmap step 5), because the first member who
builds something will set the pattern for everyone after.

A few words used below:

- **The core** is the part of WaveCenter every tool shares: who the members
  are, their tasks, their points, and later reputation and votes. In this
  repository it is the `core/` folder plus the database.
- **A tool** is anything a member builds that people use: a game, a poll, a
  calendar, a community space. Normie (normie.one) is the kind of thing meant.
- **Crediting** means recording, in the core, that a member did something
  worth points, so the points land on the right person.

## What the canon says

From *White Paper: The Decentralized Engagement Organization — Dane v2*
(Dane's Google Drive, `DEO` folder). These quotes are the parts that bear on
how tools attach.

**Every engagement is captured, whatever tool it happens in.**

> "Every possible form of engagement maps to the system's data models, so
> that when an action occurs (authoring a proposal, committing code, taking a
> poll, mentoring a newcomer), it is captured, tracked, and valued; nothing a
> member contributes goes unaccounted for."

**Building the platform is itself engagement.**

> "Development is collaborative — the platform is built by the same community
> that uses it, with code, design, documentation, and review all tracked as
> engagement like everything else."

**Members discover the DEO through its tools, before they register.**

> "The prospect engages with public content, tools, games, or polls — and
> then discovers they have already earned tokens, claimable at any time by
> registering."

**Members own their data.**

> "[A]ll members are anonymous by default, known to their inviters but to no
> one else, owning their personal data and interaction history outright and
> sharing it only at their own discretion."

**Members value each kind of engagement by vote.**

> "The valuations themselves are set by the members through a continuously
> voted valuation repository — an open database listing every category of
> engagement alongside it’s current reward."

**The ledger is the part that must never be in doubt.**

> "[B]lockchain at the core so that engagement records, valuations, votes,
> and reputational history live on an immutably private, publicly auditable
> ledger."

**Any part of the stack can be replaced.**

> "The stack is chosen pragmatically, for durability and sovereignty rather
> than ideological purity; the moment any component threatens capture or
> dependency, it becomes a candidate for replacement."

**DEOs ally with each other, and value can move between them.**

> "[T]hose alliances carry provisions allowing a member's stored value to
> transfer into allied or successor organizations when a DEO expires."

Dane's own rule for this repository (2026-10-11, `core/README.md`) already
points the same way: *"the website in `app/` is the first client of this
core, and member-built tools are later clients."*

### What the canon does not say

The whitepaper never describes how a tool is built, approved or connected, or
who runs it. These are gaps, not assumptions. Each is a question for Dane at
the end of this page.

## Three options

### Option A: a published door into the core (an API)

**What it is.** An API ("application programming interface") is a published
list of requests one program may make of another, such as "who is this
member?" or "credit this member 5 points for finishing a poll". Under this
option the core exposes such a list, documented in plain words, and every
tool, including WaveCenter's own website, uses only that list. A member
builds their tool anywhere, in any language, hosts it themselves, and
connects it through the door.

**How a member ships a tool.** They register the tool with WaveCenter and
receive a key for it. They build and host the tool wherever they like. Their
tool asks the core who the member is and reports engagement through the
door. Nothing they write runs on WaveCenter's own servers.

**What the core must expose.** Sign-in that other sites can use ("sign in
with WaveCenter"); a way to ask who the signed-in member is, without
revealing more than that member allows; a way to report an engagement; a way
to read the current valuation of each kind of engagement.

**Crediting.** A tool reports "member X did a thing of kind Y". The core, not
the tool, decides what that kind is worth, using the members' voted
valuations. A tool can claim an action happened but can never set its own
reward. The member who built the tool is credited separately, as
development work, and could also be credited a share of the engagement their
tool generates (a decision for Dane, question 4).

**Removing a bad or abandoned tool.** Switch off its key. The tool stops
being able to read or write anything. Points it already reported stay in the
ledger, marked with the tool's name, so they could be reversed if they were
fraudulent (how, and by whom, is a decision for Dane, question 2). Nothing
in the core needs to change.

**Staying replaceable.** Strongest of the three. The door is plain web
requests that any host and any language can make. The core and each tool can
each move hosts, or be rewritten, without the other noticing.

**Cost.** The most up-front design work: the door must be thought through,
documented and kept stable, because changing it breaks other people's tools.

### Option B: separate apps sharing one sign-in

**What it is.** Each tool is its own app, and all of them use the same
member accounts, so a member signs in once and is known everywhere. The
tools talk to the same database directly, each limited by rules in the
database about which rows it may touch (the same row-level security every
WaveCenter table will have).

**How a member ships a tool.** They are given access to WaveCenter's
database under their tool's own restricted role, build their app (most
likely in the same stack), and host it. Their app reads and writes the
shared tables directly.

**What the core must expose.** The shared sign-in, and the database tables
themselves, each with rules saying which tool may do what.

**Crediting.** Each tool writes engagement rows straight into the ledger
table. The database rules must stop a tool from writing points it is not
entitled to, which means the valuation rules live inside the database rather
than in `core/`.

**Removing a bad or abandoned tool.** Revoke its database role. Harder to do
cleanly than A: a tool that has been writing to shared tables for months may
have left rows other tools now depend on, and its code may have assumed table
shapes the core later wants to change.

**Staying replaceable.** Weakest. Every tool is tied to the exact shape of
WaveCenter's tables and to Supabase's sign-in. Changing a table, or moving
off Supabase, breaks every member's tool at once.

**Cost.** Quick to start, expensive later. It is how many projects begin and
how many get stuck.

### Option C: plug-ins inside the main site

**What it is.** A plug-in is code a member writes that runs inside
WaveCenter's own website, the way an app runs inside a phone. Members submit
plug-ins; once approved, they appear as part of WaveCenter.

**How a member ships a tool.** They write it in the same stack (TypeScript,
React), against a plug-in framework WaveCenter would have to design, and
submit it for review. It is deployed with the main site.

**What the core must expose.** A plug-in framework: where a plug-in may draw
on screen, which core functions it may call, and how it is reviewed and
switched on.

**Crediting.** Plug-ins call `core/` functions directly, so crediting goes
through the same rules as the website's own features. That part is simple.

**Removing a bad or abandoned tool.** Switch it off and redeploy. But a
plug-in runs inside the main site with the site's own powers, so a bad one
can do real harm before anyone notices: read other members' data in the
browser, slow every page, or break the build for everyone. Every plug-in
would need a careful code review before it goes live, and someone has to do
that reviewing.

**Staying replaceable.** Poor. Plug-ins are written for this framework, so
replacing Next.js would mean every member rewriting their plug-in.

**Cost.** Highest risk to the core; slowest for members, who wait on review
and on WaveCenter's release schedule.

### The three side by side

| | A: published door | B: shared sign-in and database | C: plug-ins inside |
|---|---|---|---|
| Who sets the points | The core | Rules inside the database | The core |
| Removing a tool | Switch off its key | Revoke its role; leftovers likely | Switch off and redeploy; harm possible before then |
| A bad tool can hurt the core | Least | Some | Most |
| Survives changing host or framework | Yes | No | No |
| Member's freedom of stack and host | Any | Mostly the same stack | Same stack only |
| Work before the first outside tool | Most | Least | Middle |
| Fits a later blockchain ledger | Yes: the door can write to it | Hard: tools write to tables directly | Yes: through `core/` |
| Fits alliances between DEOs | Yes: another DEO is just another client | Poorly | No |

## Recommendation: Option A, reached in small steps

Option A is the only one that keeps the stack replaceable (engineering rule
11), keeps the core's rules in `core/` (rule 10), lets a member's tool be
removed without harming anyone else's, and matches the whitepaper's picture
of tools anywhere feeding one ledger, including tools from allied DEOs.

It does not need to be built all at once. **The smallest first step that
closes off nothing:**

1. **Make WaveCenter's own website a client of the door from the start.**
   As the to-do list and project manager grow, every change to tasks and
   points goes through functions in `core/` with plain, stable names
   (such as "complete a task", "credit engagement"). The website calls those
   functions, never the database directly for anything that earns points.
   This costs almost nothing now, and it is the door in everything but name:
   publishing it later is a matter of putting a web address in front of
   functions that already exist.
2. **Record where each engagement came from.** When the game layer's ledger
   is designed, each entry names the tool that reported it (today, always
   "WaveCenter"). Then removing a tool, or reversing its points, is possible
   from the first day there is more than one.

Neither step stops Dane choosing B or C later: B would still work against
the same tables, and C would still call the same `core/` functions.

The rest of Option A (sign-in for other sites, keys per tool, the published
document) waits until a real member has a real tool to connect, because the
first real tool will show what the door actually needs.

## Where blockchain, tokens and governance attach

Not decided here; only where they would plug in.

- **Blockchain.** Behind the door. Tools report engagement to the core; the
  core decides whether the record goes to a database, a blockchain, or both.
  Tools do not change when the ledger does.
- **Tokens.** Read through the door ("what is my balance?"). Only the core
  ever creates them.
- **Governance and votes.** Voting is engagement, so a voting tool is just
  another client reporting "member X voted". The valuation repository the
  members vote on is what the core reads when it credits any tool's reported
  engagement.

## Questions for Dane

The whitepaper and `docs/MISSION.md` do not answer these. Nothing in this
page assumes an answer.

1. **Which option?** A, B or C, or the first step of A now and the rest
   later.
2. **Who may connect a tool, and who may undo its points?** Any member,
   members above some reputation, or only after a vote? And if a tool turns
   out to have reported fraudulent points, who may reverse them, and how?
3. **Who approves a new kind of engagement?** When a tool reports something
   new ("finished a poll"), does it earn nothing until the members vote it a
   value, or does it start with a provisional value?
4. **What does a tool's builder earn?** Points for building it only, or also
   a share of the engagement their tool brings in?
5. **What may a tool learn about a member?** The whitepaper says members are
   anonymous by default and share at their own discretion. Is a tool given a
   different anonymous identifier for each member, so tools cannot compare
   notes, or one identifier shared across tools?
6. **Tools before registration.** The retroactive token reveal means tools
   count engagement from people who have not joined yet. Where is that held,
   and for how long, before it is claimed?
7. **Tools from other DEOs.** Should an allied DEO's tool connect through the
   same door, under the same rules, as a member's tool?
