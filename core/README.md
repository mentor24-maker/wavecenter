# core/ — WaveCenter's heart, independent of any framework

Everything that defines WaveCenter as a DEO lives here: the task record, the
points rules, and the rules for who may do what. It is plain TypeScript with
its own tests.

**Nothing in this folder may import Next.js, React, or anything from Vercel.**
That is Dane's condition (2026-10-11) for choosing Next.js at all: the website
in `app/` is the first *client* of this core, and member-built tools are later
clients. If the framework is ever replaced, this folder does not change.
`npm run check:core-boundary` enforces it, and CI runs that check.

The folder is empty until the task-record ticket lands.
