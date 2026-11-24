## 2026-11-23 — Made points final earns its point (#194)

An admin can end the "provisional" phase of scoring from the Admin page,
which locks every member's points in for good ("making points final").
Doing that used to earn nothing: Game > Manage listed "Made points final"
as "Not active yet". Now the admin who does it earns one point for it, and
it shows on their Game > My Points page like any other action.

It can only ever happen once in a DEO's life, so it can only ever be earned
once. A second try is refused and earns nothing. If the point cannot be
saved, points stay provisional, so the two always agree. A change made
behind the scenes with the server's own key, with nobody signed in, earns
nobody anything.

The action also got its four scores with a reason for each (effort 1,
value 2, rarity 2, farm risk 0). Its points stay at 1 until an admin puts
the formula's value live.
