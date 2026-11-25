## 2026-11-24 — Website manager: preview a page on phone, tablet and desktop (#205)

The page editor now has a **Preview** switch with Phone, Tablet and Desktop. Clicking one shows the page,
unsaved changes included, the way that kind of screen will show it, using the same drawing code visitors
get. When the editor window is too small for the device, the preview shrinks the picture to fit but keeps
the device's real width, so what you see is still what that device gets.

Each section also gets three settings: hide it on phones, hide it on desktops, and whether its columns
stack one above another on a phone (on by default, which is how every page already behaved).

Why it matters: most visitors arrive on a phone. Before this, the only way to see a page on a phone was to
publish it and open it on one. Now the check happens before publishing, and a section that only makes sense
on a big screen can be left off small ones.

Under the hood, "phone" and "desktop" are measured on the page itself rather than the whole browser window,
so the preview box and a real phone follow exactly the same rules. StarCaster needed a separate embedded
window for this; WaveCenter does not.
