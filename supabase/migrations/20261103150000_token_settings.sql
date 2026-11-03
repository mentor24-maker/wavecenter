-- Token sizes for the earned-points animation (Dane, 2026-11-03: "The
-- manager should allow the user to control the size and color of tokens (the
-- rotating discs) and the point levels associated with those sizes"). One
-- new table, edited from Game → Manage. No new permission: changing a size
-- needs game.edit ("Manage game scoring", 20261031140000_game_scoring_admin.sql),
-- the same as the scoring rules.
--
-- The rules live in core/tokens.ts (checkTokenSize, tokenSizeFor,
-- addTokenSize, changeTokenSize, removeTokenSize); a test keeps the limits
-- here in step with them. The row-level security below repeats who may
-- change a size, so a client that went around core still cannot.
-- Plain-words explanation: docs/DATA_MODEL.md.
--
-- Additive only. Safe to re-run: every statement checks before it creates,
-- and the starting sizes go in only while the table is empty.

-- One row is one token size. The point level is the fewest points that show
-- this size; no two sizes share one.
create table if not exists public.token_sizes (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null check (length(btrim(name)) between 1 and 40),
  diameter   integer     not null check (diameter between 8 and 64),
  color      text        not null check (color ~ '^#[0-9a-f]{6}$'),
  min_points integer     not null unique check (min_points >= 1),
  tool       text        not null default 'wavecenter' check (length(btrim(tool)) > 0),
  updated_by uuid        default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Engineering rule 2: row-level security is on from the moment the table
-- exists. Start from no rights at all and grant only what is used.
alter table public.token_sizes enable row level security;

revoke all on public.token_sizes from anon, authenticated;

-- Who changed a size and when are the database's.
grant select on public.token_sizes to authenticated;
grant insert (name, diameter, color, min_points, tool) on public.token_sizes to authenticated;
grant update (name, diameter, color, min_points, tool) on public.token_sizes to authenticated;
grant delete on public.token_sizes to authenticated;

drop policy if exists "token_sizes: every member can read"            on public.token_sizes;
drop policy if exists "token_sizes: manage game scoring can add"      on public.token_sizes;
drop policy if exists "token_sizes: manage game scoring can change"   on public.token_sizes;
drop policy if exists "token_sizes: manage game scoring can remove"   on public.token_sizes;

create policy "token_sizes: every member can read" on public.token_sizes
  for select to authenticated using (true);
create policy "token_sizes: manage game scoring can add" on public.token_sizes
  for insert to authenticated with check ((select private.may('game.edit')));
create policy "token_sizes: manage game scoring can change" on public.token_sizes
  for update to authenticated using ((select private.may('game.edit'))) with check ((select private.may('game.edit')));
create policy "token_sizes: manage game scoring can remove" on public.token_sizes
  for delete to authenticated using ((select private.may('game.edit')));

-- Stamp who changed a size and when: never what the browser sent.
create or replace function public.token_sizes_stamp()
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

drop trigger if exists token_sizes_stamp on public.token_sizes;
create trigger token_sizes_stamp before insert or update on public.token_sizes
  for each row execute function public.token_sizes_stamp();

-- Three starting sizes, so the animation has something to use before anyone
-- edits them.
insert into public.token_sizes (name, diameter, color, min_points, tool)
select v.name, v.diameter, v.color, v.min_points, 'migration'
  from (values
    ('Small',  14, '#38bdf8',  1),
    ('Medium', 20, '#f59e0b',  5),
    ('Large',  28, '#e11d48', 20)
  ) as v (name, diameter, color, min_points)
 where not exists (select 1 from public.token_sizes);

notify pgrst, 'reload schema';
