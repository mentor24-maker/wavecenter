# The website manager

WaveCenter's own page builder, reached from **Admin → Website**
(`/admin/website`).

Dane, 2026-11-22 (WC-206): "WaveCenter needs it's own page builder along the
lines of Starcaster and Normie. Cannibalize both of those repositories to
develop a new and improved version for WaveCenter. Link to it from the Admin
page for now." On the ticket he chose **A**: start from Normie's leaner
builder, then bring in StarCaster's best parts one ticket at a time.

"Cannibalize" here means code is copied in and adapted, never imported from
those repositories, and nothing in WaveCenter depends on them at runtime.

## The two builders compared

| | Normie | StarCaster |
|---|---|---|
| Size | One 820-line editor (`components/admin-builder-editor.tsx`) and one 1,287-line shape file (`lib/builder-template.ts`) | About 250 files in `components/builder/` plus a 3,766-line editor |
| Storage | One `pages` table: name, slug, template, `layout_sections` as JSON, published flag | Pages, templates, saved sections, themes, media, each in its own tables |
| Page shape | A page is a list of **sections**; each has a layout (single, two-column, three-column, uneven splits), spacing, background and **modules** placed in its cells | The same idea, grown: locked and linked ("canonical") sections, per-device styles, parallax and video backgrounds |
| Modules | About 23 (heading, text, image, button, video, slider, forms, polls…) | Dozens more (blog, CRM, media, agents…), each with its own settings panel, held to `docs/MODULE_UI_DOCTRINE.md` |
| Publishing | `is_published` on the page; a public page is read by slug | Drafts, publish decisions after a save, custom domains |
| Preview | Draft saved to the browser and shown in a preview tab | A built-in phone / tablet / desktop preview |

## What WaveCenter takes, drops and improves

**Takes from Normie:** the storage model (one table of pages, sections as
JSON), the section-and-cell layout list, and the first, simplest modules.
It is small enough to read in an afternoon and port in slices.

**Takes from StarCaster, later:** the device preview, saved sections reused
on many pages (with its lesson from `docs/SAVED_SECTIONS.md`: one flag, one
meaning), and the one-panel-per-module settings doctrine.

**Drops, for now:** blog, CRM, forms, polls, merch, email templates, themes,
custom domains and the media library. Each can return as its own ticket when
Dane asks for it.

**Improves:**

- **Rules live in `core/`** (`core/website.ts`), plain TypeScript with tests,
  never in a screen. Who may manage pages is a permission, **Manage website**
  (`site.edit`), admin only to start.
- **Row-level security from the first migration, checked against the
  member.** Anyone sees a published page; only a role with Manage website
  sees drafts or writes pages. Pages are written as the signed-in member,
  never with the service key, so the database itself checks who may.
- **Text is WaveCenter's rich-text format, never HTML,** so nothing typed into
  a page can run in a visitor's browser. Both older builders store rich text
  as HTML.
- **Every failed save says so, and every empty screen says why** (engineering
  rules 6 and 7).
- **Website work earns points** in the game layer, like every other
  contribution.
- **Standard hosting only** (rule 11): nothing here needs Vercel.

## The steps

Each step is one pull request and its own ticket, tagged `website-manager`.
Each waits on the one before it (the `Waits on:` line), so they build in
order.

| Step | Ticket | What it does | Waits on |
|---|---|---|---|
| 1 | [WC-206](http://mac-mini.local:4180/t/WC-206) | This plan; the Website link on Admin; the page list; making a page (name and address) as a draft | — |
| 2 | [WC-207](http://mac-mini.local:4180/t/WC-207) | Website manager: change, publish and delete a page | WC-206 |
| 3 | [WC-208](http://mac-mini.local:4180/t/WC-208) | Website manager: build a page from sections and layouts | WC-207 |
| 4 | [WC-209](http://mac-mini.local:4180/t/WC-209) | Website manager: first modules for headings, text, pictures and buttons | WC-208 |
| 5 | [WC-210](http://mac-mini.local:4180/t/WC-210) | Website manager: show published pages at their own web address | WC-209 |
| 6 | [WC-211](http://mac-mini.local:4180/t/WC-211) | Website manager: preview a page on phone, tablet and desktop | WC-210 |
| 7 | [WC-212](http://mac-mini.local:4180/t/WC-212) | Website manager: save a section once, reuse it on many pages | WC-208 |
| 8 | [WC-213](http://mac-mini.local:4180/t/WC-213) | Website manager: making and publishing pages earns game points | WC-207 |

## What is built so far (WC-206)

- `site_pages` table (`supabase/migrations/20261124120000_site_pages.sql`):
  id, name, slug (the page's address), `layout_sections` (empty until the
  editor exists), `is_published` (false for a new page), who made it, the
  tool, and when. Row-level security is on from the migration that makes it.
  Only reading and adding are granted; changing and deleting come in WC-207.
- `core/website.ts`: `mayManageWebsite`, `sitePageSlug` (the address a name
  suggests), `addSitePage` (the only way to make a page), with tests in
  `core/website.test.ts`.
- `/admin/website`: the page list and the New page form.

## Built in WC-207: change, publish and delete a page

- `supabase/migrations/20261124130000_site_pages_edit.sql` grants changing a
  page's name, address and published state, and deleting a page, to a role
  with Manage website only; a change stamps `updated_at`. Who made a page,
  when, its tool and its sections cannot be changed this way.
- `core/website.ts`: `changeSitePage` and `deleteSitePage`, under the same
  rules as `addSitePage` (an address another page uses is refused), with
  tests.
- `/admin/website/<id>`: a page's details (name, address, status, made, last
  changed) with Edit, Publish / Back to draft, and Delete with an "are you
  sure" step. The page list's names link to it.

## Built in WC-208: build a page from sections and layouts

- A page is a stack of **sections**, top to bottom. Each has a layout (one
  column; two or three equal columns; or one of Normie's uneven splits, 1 : 2,
  2 : 1, 1 : 5 and 5 : 1), an alignment, space above and below (0 to 160
  pixels), an optional title for the editor's own reference, and one
  background colour or none. Each column of the layout is a **cell**, where
  modules will go (WC-209).
- `core/website.ts`: the section shape, `normalizeSiteSections` (Normie's
  `normalizeLayoutSections`, trimmed to these fields: whatever is stored is
  tidied into a well-formed list and never breaks a screen),
  `siteSectionChanges` (the unsaved changes in words) and
  `saveSitePageSections`, with tests.
- `supabase/migrations/20261124140000_site_pages_sections.sql` grants a role
  with Manage website changing a page's sections, and holds them to at most
  50 sections and 200,000 bytes, the same limits core checks
  (`SITE_SECTIONS_MAX`, `SITE_SECTIONS_BYTES_MAX`; core counts the bytes the
  way the database writes them).
- `/admin/website/<id>/edit`, reached by **Edit sections** on a page's
  screen: add a section with a chosen layout, change its settings, move it
  up or down, remove it, and Save. Unsaved changes are named on screen
  ("1 section added, the order changed") and leaving asks first. A failed
  save says so and keeps the sections on screen.
