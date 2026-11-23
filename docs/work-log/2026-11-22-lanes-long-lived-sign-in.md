## 2026-11-22 — WaveCenter's lanes stop by Nov 25: use the long-lived Claude sign-in (#175)

The Mac Mini signs in to Claude through a browser login, and that login ends
on a fixed date, at the latest November 25. When it ends, every WaveCenter
lane (the build, review, intake and hand-off loops) would stop working.
Spirality's lanes already avoid this with a long-lived token made for
unattended jobs, which lasts about a year.

This change teaches both of WaveCenter's lane runners the same trick. Before
each pass, the runner asks Doppler (where the keys live) for that token, in
WaveCenter's own settings, where it is a pointer to Spirality's so there is
only one token to replace. If the token is there, the pass uses it; if not,
the pass carries on with the browser login exactly as before. Either way the
lane's log gets one line saying which sign-in it used. The token itself never
shows in a log or a process list: only the Claude program receives it.

Still to do outside this change: Dane makes the token on the Mini
(`claude setup-token`, a browser login) and stores it from Spirality's folder,
and an agent session sets WaveCenter's pointer to it in Doppler (the lane was
not allowed to make that Doppler write).
