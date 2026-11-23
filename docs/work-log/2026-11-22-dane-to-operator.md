## 2026-11-22 — Global find-replace of 'Dane' to 'Operator' (#171)

Two sentences on WaveCenter's screens used Dane's name to mean "the person
running WaveCenter". Both now say "the operator" instead. One is the AI task
ratings note on the Admin page ("through Claude Code under the operator's
plan"). The other is the line Home shows when the Evolution row cannot load.
The DEO page keeps "by Dane Christensen", because that credits the
whitepaper's real author.

Alongside, Dane asked how often the code and docs use his name for the
operator role. A survey sorted all 818 lines into three kinds: 527 record a
decision or authorship of his, 231 use his name for the role, and 60 are a
sample member in a test. The survey is posted on WC-179 and in the pull
request. Only a handful of code names use his name for the role, such as
`fromDane`, `danesAnswer` and `DANE_ID`. It recommends one small ticket to
rename those, and leaving the comments as they are.
