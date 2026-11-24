## 2026-11-22 — Allow for Sub-topics (#178)

Forum topics can now be grouped under one another from each topic's own
page. The page lists the topic's sub-topics ("No sub-topics yet" when there
are none) and has two dropdowns: "Parent topic", to put this topic under
another (or back to top level with "None"), and "Adopt a sub-topic", to
pull another topic in under this one.

Why it matters: members can now shape the Forum into broad subjects with
narrower ones beneath them, instead of one flat list. The dropdowns never
offer a choice that would put a topic under itself, directly or through a
chain, and they follow the rule Dane chose for WC-183: only the member who
added a topic, or an admin, may move it. A save that fails says why on the
page. No database change was needed; WC-183 had already laid the
groundwork and its safety checks still pass on the test database.
