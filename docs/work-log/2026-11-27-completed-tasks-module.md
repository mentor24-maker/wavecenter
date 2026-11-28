## 2026-11-27 — Latest Completed Task module in website manager (#233)

The website manager has a new module, **Recently completed tasks**, that
puts the list from the bottom of signed-in Home onto any website page: the
five tasks finished most recently, newest first, each a link to the task
with the day it was done.

Home and the new module now get their list from the very same piece of
code, so the two can never show different tasks. Home looks exactly as it
did.

Website pages are open to anyone, so the module follows the same rule as the
Leaderboard module: someone who is not signed in sees no task names, only a
note to sign in. If WaveCenter could not even check whether they are signed
in, it says that instead. When no task has been finished yet, or the list
could not be read, the module says so in words rather than showing an empty
box. Its only setting is the heading above the list.
