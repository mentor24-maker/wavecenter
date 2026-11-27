## 2026-11-26 — Let members attach tags to a forum topic (#221)

A Forum topic can now carry tags. Until now, topics and tags were two
separate lists with nothing joining them. Now, whoever added a topic (or an
admin) opens the topic's edit page and picks tags for it from the existing
tag list, or removes them. Each change saves at once.

You can see the join from both sides: the topic's page lists its tags as
links, and each tag's page lists every topic that carries it. So opening the
Voting tag shows every topic about voting.

Behind the scenes there is one new table holding the topic-and-tag pairs. Its
security rules were switched on in the same step that made it, so only the
topic's adder or an admin can tag a topic, even if someone tries to go around
the screens; ten new checks on the test database prove it. Deleting a topic
or a tag tidies away its pairs. Earning a point for tagging is left for a
later ticket.
