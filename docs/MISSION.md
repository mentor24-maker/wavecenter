# WaveCenter — mission and roadmap

## Mission

WaveCenter is the hub of the DEO movement, and the original DEO.

- **As a DEO**, its mission is to build a modern alternative to the World Wide
  Web.
- **As the hub**, that new architecture becomes the platform where other DEOs
  extend the mission or develop new concepts.

*Source note:* this two-part mission is Dane's statement. The whitepaper
defines what a DEO is but does not mention WaveCenter or a Web alternative.

## What a DEO is (from the whitepaper)

Source: *White Paper: The Decentralized Engagement Organization — Dane v2*
(Dane Christensen with Claude Fable, July 2026).

A DEO is an organization in which **human engagement, not capital
investment,** is the founding resource, the operating fuel and the purpose.
Its central idea: *human creative collaboration is the main source of value,
and coordination is how that value is created and captured.* Capital is one
way to coordinate people, but not the only one, and not always the right one.

What sets a DEO apart is one commitment: **every act of engagement is
captured, valued and credited to the member who performed it.** That record
is the game layer, and it is native to the system, not bolted on.

The commitments that matter most for what we build:

- **Native game layer.** Every kind of engagement maps to the data model and
  earns points. Members vote on what each kind of engagement is worth, so
  values settle at their natural level, much as prices do in a market.
- **Governance runs through the game layer.** Voting is a form of engagement
  and is rewarded. Voting weight is earned tokens multiplied by a reputation
  score that cannot be transferred, so influence cannot be bought.
- **No fiat pay inside.** Members earn points and tokens, never dollars. Cash
  enters only as revenue from selling what the DEO produces. It never enters
  as investment or debt.
- **Data sovereignty.** Members are anonymous by default and own their data.
- **Verified humans, by invitation.** Membership is by invitation, each
  inviter is accountable for the people they invite, and every member is a
  verified unique human.
- **Integrated AI** helps the members and never replaces them. Humans have
  the final say over every automated decision.
- **Decentralized stack.** Over time: Web3 rails, with a blockchain at the
  core for engagement records, valuations and votes. The stack is chosen
  pragmatically and replaced if any part of it threatens capture.
- **URL > IRL.** A DEO begins online and takes physical form over time.
  In-person engagement is valued highest.

A DEO grows through four **seasons**: **Winter** (plans and code, no people
yet), **Spring** (members join and build part-time), **Summer** (production
and revenue), **Fall** (harvest and distribution, on terms the members
ratified in advance).

WaveCenter is in **Winter**.

## Roadmap

### The trajectory

1. A simple to-do list. ← *we are here*
2. A basic project management tool modeled on ClickUp.
3. Dane uses it to plan a more robust project management system.
4. That system has the game layer built into its substrate.
5. The plan is broken into tasks with defined points. Others are invited in
   through the platform, and the project bootstraps itself.

### Launch plan (approved 2026-10-03, in priority order)

| # | Step | Status |
|---|---|---|
| 1 | Create the GitHub repo | Done |
| 2 | Founding documents (`CLAUDE.md`, this file) | In progress |
| 3 | Separate Supabase project for WaveCenter | Not started |
| 4 | Keys in Doppler from day one | Started 2026-10-11: project `wavecenter` exists, ClickUp token in `dev` |
| 5 | Vercel project, placeholder page live, build check before deploy | Not started |
| 6 | Task record designed for growth: owner, status, parent task, points | Not started |
| 7 | Sign-in plus per-user data protection (row-level security) | Not started |
| 8 | Build the simple to-do list | Not started |
| 9 | Make the site presentable; pick a domain | Not started |
| 10 | Move WaveCenter's own tasks from ClickUp into WaveCenter | Not started |

Steps 3–10 are filed as tickets in the WaveCenter **Loop Queue** in ClickUp
(2026-10-11). The queue is the live status; this table is the plan.

### Points are the seed of the game layer

Step 6 matters more than it looks. Points on the first to-do item are the
earliest form of the whitepaper's engagement ledger. Design the task record
so a later step can add the voted valuation table, reputation and
member-to-member engagement without rebuilding it.
