-- Home's box words, editable from Home (Dane, 2026-11-01, from the WaveCenter
-- task "Make the home page modules editable with permissions": "An Admin user
-- will see a small edit icon in the lower right corner of each module on the
-- home page, other than the slider. Clicking it will launch a rich text
-- editor populated with the current content"). He chose "B" the same
-- evening: only About WaveCenter and What is a DEO for now. One new table and
-- one new permission:
--
--   home.edit  Edit Home boxes  admin only, to start
--
-- The rules live in core/homeBoxes.ts and core/members.ts (PERMISSIONS,
-- STARTING_ROLE_PERMISSIONS); a test keeps this file in step with them. The
-- row-level security below repeats who may change the words, so a client
-- that went around core still cannot. A box with no row shows the words it
-- was built with, which live in core. Plain-words explanation:
-- docs/DATA_MODEL.md.
--
-- Additive only. Safe to re-run: every statement checks before it creates.

insert into public.permissions (key, label, position) values
  ('home.edit', 'Edit Home boxes', 11)
on conflict (key) do nothing;

insert into public.role_permissions (role, permission) values
  ('admin', 'home.edit')
on conflict do nothing;

-- One row is one box's saved words, in the rich-text format of task comments
-- (core/richText.ts): plain words, never HTML.
create table if not exists public.home_boxes (
  box        text        primary key check (box in ('about', 'deo')),
  body       text        not null check (length(btrim(body, E' \t\r\n')) > 0 and length(body) <= 2000),
  tool       text        not null default 'wavecenter' check (length(btrim(tool)) > 0),
  updated_by uuid        default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Engineering rule 2: row-level security is on from the moment the table
-- exists. Start from no rights at all and grant only what is used.
alter table public.home_boxes enable row level security;

revoke all on public.home_boxes from anon, authenticated;

-- A save is an upsert, which names the box in both its insert and its
-- update; who changed it and when are the database's.
grant select on public.home_boxes to authenticated;
grant insert (box, body, tool) on public.home_boxes to authenticated;
grant update (box, body, tool) on public.home_boxes to authenticated;

drop policy if exists "home_boxes: every member can read"      on public.home_boxes;
drop policy if exists "home_boxes: edit home boxes can add"    on public.home_boxes;
drop policy if exists "home_boxes: edit home boxes can change" on public.home_boxes;

create policy "home_boxes: every member can read" on public.home_boxes
  for select to authenticated using (true);
create policy "home_boxes: edit home boxes can add" on public.home_boxes
  for insert to authenticated with check ((select private.may('home.edit')));
create policy "home_boxes: edit home boxes can change" on public.home_boxes
  for update to authenticated using ((select private.may('home.edit'))) with check ((select private.may('home.edit')));

-- Stamp who changed the words and when: never what the browser sent.
create or replace function public.home_boxes_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists home_boxes_stamp on public.home_boxes;
create trigger home_boxes_stamp before insert or update on public.home_boxes
  for each row execute function public.home_boxes_stamp();

notify pgrst, 'reload schema';
